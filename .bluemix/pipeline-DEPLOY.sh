#!/bin/bash

################################################################
# Install dependencies
################################################################

echo 'Installing dependencies...'
sudo apt-get -qq update
sudo apt-get -qq install jq

echo 'Installing nvm (Node.js Version Manager)...'
npm config delete prefix
(curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.31.2/install.sh | bash) 1>/dev/null
. ~/.nvm/nvm.sh

echo 'Installing Node.js 6.9.1...'
nvm install 6.9.1 1>/dev/null
npm install --progress false --loglevel error 1>/dev/null

################################################################
# Create services
################################################################

# Create Cloudant service
echo 'Creating Cloudant service...'
cf create-service cloudantNoSQLDB Lite cloudant-for-darkvision
cf create-service-key cloudant-for-darkvision for-darkvision

CLOUDANT_CREDENTIALS=`cf service-key cloudant-for-darkvision for-darkvision | tail -n +2`
export CLOUDANT_username=`echo $CLOUDANT_CREDENTIALS | jq -r .username`
export CLOUDANT_password=`echo $CLOUDANT_CREDENTIALS | jq -r .password`
export CLOUDANT_host=`echo $CLOUDANT_CREDENTIALS | jq -r .host`
# Cloudant database should be set by the pipeline, use a default if not set
if [ -z ${CLOUDANT_db+x} ]; then
  echo 'CLOUDANT_db was not set in the pipeline. Using default value.'
  export CLOUDANT_db=openwhisk-darkvision
fi

echo 'Creating '$CLOUDANT_db' database...'
# ignore "database already exists error"
curl -s -X PUT "https://$CLOUDANT_username:$CLOUDANT_password@$CLOUDANT_host/$CLOUDANT_db"

# Create Watson Visual Recognition service unless WATSON_API_KEY is defined in the service
if [ -z ${WATSON_API_KEY+x} ]; then
  echo 'Creating Watson Visual Recognition service...'
  cf create-service watson_vision_combined free visualrecognition-for-darkvision
  cf create-service-key visualrecognition-for-darkvision for-darkvision

  VISUAL_RECOGNITION_CREDENTIALS=`cf service-key visualrecognition-for-darkvision for-darkvision | tail -n +2`
  export WATSON_API_KEY=`echo $VISUAL_RECOGNITION_CREDENTIALS | jq -r .api_key`
fi

# Create Watson Speech to Text service
echo 'Creating Watson Speech to Text...'
cf create-service speech_to_text standard speechtotext-for-darkvision
cf create-service-key speechtotext-for-darkvision for-darkvision

STT_CREDENTIALS=`cf service-key speechtotext-for-darkvision for-darkvision | tail -n +2`
export STT_USERNAME=`echo $STT_CREDENTIALS | jq -r .username`
export STT_PASSWORD=`echo $STT_CREDENTIALS | jq -r .password`
export STT_URL=`echo $STT_CREDENTIALS | jq -r .url`

# Docker image should be set by the pipeline, use a default if not set
if [ -z ${DOCKER_EXTRACTOR_NAME+x} ]; then
  echo 'DOCKER_EXTRACTOR_NAME was not set in the pipeline. Using default value.'
  export DOCKER_EXTRACTOR_NAME=l2fprod/darkvision-extractor-master
fi

################################################################
# OpenWhisk artifacts
################################################################

echo 'Deploying OpenWhisk artifacts...'

# Retrieve the OpenWhisk authorization key
CF_ACCESS_TOKEN=`cat ~/.cf/config.json | jq -r .AccessToken | awk '{print $2}'`

# Docker image should be set by the pipeline, use a default if not set
if [ -z ${OPENWHISK_API_HOST+x} ]; then
  echo 'OPENWHISK_API_HOST was not set in the pipeline. Using default value.'
  export OPENWHISK_API_HOST=openwhisk.ng.bluemix.net
fi
OPENWHISK_KEYS=`curl -XPOST -k -d "{ \"accessToken\" : \"$CF_ACCESS_TOKEN\", \"refreshToken\" : \"$CF_ACCESS_TOKEN\" }" \
  -H 'Content-Type:application/json' https://$OPENWHISK_API_HOST/bluemix/v2/authenticate`

SPACE_KEY=`echo $OPENWHISK_KEYS | jq -r '.namespaces[] | select(.name == "'$CF_ORG'_'$CF_SPACE'") | .key'`
SPACE_UUID=`echo $OPENWHISK_KEYS | jq -r '.namespaces[] | select(.name == "'$CF_ORG'_'$CF_SPACE'") | .uuid'`
OPENWHISK_AUTH=$SPACE_UUID:$SPACE_KEY

export STT_CALLBACK_URL=https://$OPENWHISK_API_HOST/api/v1/experimental/web/${CF_ORG}_${CF_SPACE}/vision/speechtotext.http
echo 'Speech to Text OpenWhisk action is accessible at '$STT_CALLBACK_URL

# Deploy the actions
node deploy.js --apihost $OPENWHISK_API_HOST --auth $OPENWHISK_AUTH --uninstall
node deploy.js --apihost $OPENWHISK_API_HOST --auth $OPENWHISK_AUTH --install

################################################################
# Register the Speech to Text callback URL
################################################################
STT_REGISTER_CALLBACK=$STT_URL'/api/v1/register_callback?callback_url='$STT_CALLBACK_URL'&user_secret='$STT_CALLBACK_SECRET
echo 'Registering Speech to Text callback URL with '$STT_REGISTER_CALLBACK
curl -v -X POST -u "${STT_USERNAME}:${STT_PASSWORD}" --data "{}" "${STT_REGISTER_CALLBACK}"

################################################################
# And the web app
################################################################

# Push app
echo 'Deploying web application...'
cd web
if ! cf app $CF_APP; then
  cf push $CF_APP --hostname $CF_APP --no-start
  if [ -z ${ADMIN_USERNAME+x} ]; then
    echo 'No admin username configured'
  else
    cf set-env $CF_APP ADMIN_USERNAME "${ADMIN_USERNAME}"
    cf set-env $CF_APP ADMIN_PASSWORD "${ADMIN_PASSWORD}"
  fi
  cf start $CF_APP
else
  OLD_CF_APP=${CF_APP}-OLD-$(date +"%s")
  rollback() {
    set +e
    if cf app $OLD_CF_APP; then
      cf logs $CF_APP --recent
      cf delete $CF_APP -f
      cf rename $OLD_CF_APP $CF_APP
    fi
    exit 1
  }
  set -e
  trap rollback ERR
  cf rename $CF_APP $OLD_CF_APP
  cf push $CF_APP --hostname $CF_APP --no-start
  if [ -z ${ADMIN_USERNAME+x} ]; then
    echo 'No admin username configured'
  else
    cf set-env $CF_APP ADMIN_USERNAME "${ADMIN_USERNAME}"
    cf set-env $CF_APP ADMIN_PASSWORD "${ADMIN_PASSWORD}"
  fi
  cf start $CF_APP
  cf delete $OLD_CF_APP -f
fi
