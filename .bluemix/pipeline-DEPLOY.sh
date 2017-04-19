#!/bin/bash

################################################################
# Install dependencies
################################################################
echo 'Installing dependencies...'
sudo apt-get -qq update 1>/dev/null
sudo apt-get -qq install jq 1>/dev/null
sudo apt-get -qq install figlet 1>/dev/null

figlet 'Node.js'

echo 'Installing nvm (Node.js Version Manager)...'
npm config delete prefix
curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.31.2/install.sh | bash > /dev/null 2>&1
. ~/.nvm/nvm.sh

echo 'Installing Node.js 6.9.1...'
nvm install 6.9.1 1>/dev/null
npm install --progress false --loglevel error 1>/dev/null

################################################################
# Create services
################################################################
figlet 'Services'

# Create Cloudant service
figlet -f small 'Cloudant'
cf create-service cloudantNoSQLDB Lite cloudant-for-darkvision
cf create-service-key cloudant-for-darkvision for-darkvision

CLOUDANT_CREDENTIALS=`cf service-key cloudant-for-darkvision for-darkvision | tail -n +2`
export CLOUDANT_username=`echo $CLOUDANT_CREDENTIALS | jq -r .username`
export CLOUDANT_password=`echo $CLOUDANT_CREDENTIALS | jq -r .password`
export CLOUDANT_host=`echo $CLOUDANT_CREDENTIALS | jq -r .host`
# Cloudant database should be set by the pipeline, use a default if not set
if [ -z "$CLOUDANT_db" ]; then
  echo 'CLOUDANT_db was not set in the pipeline. Using default value.'
  export CLOUDANT_db=openwhisk-darkvision
fi

echo 'Creating '$CLOUDANT_db' database...'
# ignore "database already exists error"
curl -s -X PUT "https://$CLOUDANT_username:$CLOUDANT_password@$CLOUDANT_host/$CLOUDANT_db"

# Create Watson Visual Recognition service unless WATSON_API_KEY is defined in the service
figlet -f small 'Visual Recognition'
if [ -z "$WATSON_API_KEY" ]; then
  cf create-service watson_vision_combined free visualrecognition-for-darkvision
  cf create-service-key visualrecognition-for-darkvision for-darkvision

  VISUAL_RECOGNITION_CREDENTIALS=`cf service-key visualrecognition-for-darkvision for-darkvision | tail -n +2`
  export WATSON_API_KEY=`echo $VISUAL_RECOGNITION_CREDENTIALS | jq -r .api_key`
else
  echo 'Using configured API key for Watson Visual Recognition service'
fi

# Create Watson Speech to Text service
figlet -f small 'Speech to Text'
cf create-service speech_to_text standard speechtotext-for-darkvision
cf create-service-key speechtotext-for-darkvision for-darkvision

STT_CREDENTIALS=`cf service-key speechtotext-for-darkvision for-darkvision | tail -n +2`
export STT_USERNAME=`echo $STT_CREDENTIALS | jq -r .username`
export STT_PASSWORD=`echo $STT_CREDENTIALS | jq -r .password`
export STT_URL=`echo $STT_CREDENTIALS | jq -r .url`

# Create Watson Natural Language Understanding
figlet -f small 'Natural Language Understanding'
cf create-service natural-language-understanding free nlu-for-darkvision
cf create-service-key nlu-for-darkvision for-darkvision

NLU_CREDENTIALS=`cf service-key nlu-for-darkvision for-darkvision | tail -n +2`
export NLU_USERNAME=`echo $NLU_CREDENTIALS | jq -r .username`
export NLU_PASSWORD=`echo $NLU_CREDENTIALS | jq -r .password`
export NLU_URL=`echo $NLU_CREDENTIALS | jq -r .url`

# Docker image should be set by the pipeline, use a default if not set
if [ -z "$DOCKER_EXTRACTOR_NAME" ]; then
  echo 'DOCKER_EXTRACTOR_NAME was not set in the pipeline. Using default value.'
  export DOCKER_EXTRACTOR_NAME=l2fprod/darkvision-extractor-master
fi

################################################################
# OpenWhisk artifacts
################################################################
figlet 'OpenWhisk'

echo 'Retrieving OpenWhisk authorization key...'

# Retrieve the OpenWhisk authorization key
CF_ACCESS_TOKEN=`cat ~/.cf/config.json | jq -r .AccessToken | awk '{print $2}'`

# Docker image should be set by the pipeline, use a default if not set
if [ -z "$OPENWHISK_API_HOST" ]; then
  echo 'OPENWHISK_API_HOST was not set in the pipeline. Using default value.'
  export OPENWHISK_API_HOST=openwhisk.ng.bluemix.net
fi
OPENWHISK_KEYS=`curl -XPOST -k -d "{ \"accessToken\" : \"$CF_ACCESS_TOKEN\", \"refreshToken\" : \"$CF_ACCESS_TOKEN\" }" \
  -H 'Content-Type:application/json' https://$OPENWHISK_API_HOST/bluemix/v2/authenticate`

SPACE_KEY=`echo $OPENWHISK_KEYS | jq -r '.namespaces[] | select(.name == "'$CF_ORG'_'$CF_SPACE'") | .key'`
SPACE_UUID=`echo $OPENWHISK_KEYS | jq -r '.namespaces[] | select(.name == "'$CF_ORG'_'$CF_SPACE'") | .uuid'`
OPENWHISK_AUTH=$SPACE_UUID:$SPACE_KEY

export STT_CALLBACK_URL=https://${OPENWHISK_API_HOST}/api/v1/web/${CF_ORG}_${CF_SPACE}/vision/speechtotext
echo 'Speech to Text OpenWhisk action is accessible at '$STT_CALLBACK_URL

# Deploy the actions
figlet -f small 'Uninstall'
node deploy.js --apihost $OPENWHISK_API_HOST --auth $OPENWHISK_AUTH --uninstall
figlet -f small 'Install'
node deploy.js --apihost $OPENWHISK_API_HOST --auth $OPENWHISK_AUTH --install

################################################################
# Register the Speech to Text callback URL
################################################################
figlet -f small 'Callback'
node deploy.js --apihost $OPENWHISK_API_HOST --auth $OPENWHISK_AUTH --register_callback

################################################################
# And the web app
################################################################
figlet 'Web app'

# Push app
cd web

if [ -z "$CF_APP_HOSTNAME" ]; then
  echo 'CF_APP_HOSTNAME was not set in the pipeline. Using CF_APP as hostname.'
  export CF_APP_HOSTNAME=$CF_APP
fi

if [ -z "$CF_APP_INSTANCES" ]; then
  echo 'CF_APP_INSTANCES was not set in the pipeline. Using 1 as default value.'
  export CF_APP_INSTANCES=1
fi

if ! cf app $CF_APP; then
  cf push $CF_APP -i $CF_APP_INSTANCES --hostname $CF_APP_HOSTNAME --no-start
  cf set-env $CF_APP CLOUDANT_db "${CLOUDANT_db}"
  if [ ! -z "$USE_API_CACHE" ]; then
    cf set-env $CF_APP USE_API_CACHE true
  fi
  if [ -z "$ADMIN_USERNAME" ]; then
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
  figlet -f small 'Deploy new version'
  cf rename $CF_APP $OLD_CF_APP
  cf push $CF_APP -i $CF_APP_INSTANCES --hostname $CF_APP_HOSTNAME --no-start
  cf set-env $CF_APP CLOUDANT_db "${CLOUDANT_db}"
  if [ ! -z "$USE_API_CACHE" ]; then
    cf set-env $CF_APP USE_API_CACHE true
  fi
  if [ -z "$ADMIN_USERNAME" ]; then
    echo 'No admin username configured'
  else
    cf set-env $CF_APP ADMIN_USERNAME "${ADMIN_USERNAME}"
    cf set-env $CF_APP ADMIN_PASSWORD "${ADMIN_PASSWORD}"
  fi
  cf start $CF_APP
  figlet -f small 'Remove old version'
  cf delete $OLD_CF_APP -f
fi

figlet -f slant 'Job done!'
