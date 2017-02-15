#!/bin/bash

# Install dependencies
echo 'Installing dependencies...'
sudo apt-get -qq update
sudo apt-get -qq install jq

npm config delete prefix
curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.31.2/install.sh | bash
. ~/.nvm/nvm.sh
nvm install 6.9.1
npm install

# Create Cloudant service
echo 'Creating Cloudant service...'
cf create-service cloudantNoSQLDB Lite cloudant-for-darkvision
cf create-service-key cloudant-for-darkvision for-darkvision

CLOUDANT_CREDENTIALS=`cf service-key cloudant-for-darkvision for-darkvision | tail -n +2`
export CLOUDANT_username=`echo $CLOUDANT_CREDENTIALS | jq -r .username`
export CLOUDANT_password=`echo $CLOUDANT_CREDENTIALS | jq -r .password`
export CLOUDANT_host=`echo $CLOUDANT_CREDENTIALS | jq -r .host`
export CLOUDANT_db=openwhisk-darkvision

echo 'Creating '$CLOUDANT_db' database...'
# ignore "database already exists error"
curl -s -X PUT "https://$CLOUDANT_username:$CLOUDANT_password@$CLOUDANT_host/$CLOUDANT_db"

# Create Watson Visual Recognition service
echo 'Creating Watson Visual Recognition service...'
cf create-service watson_vision_combined free visualrecognition-for-darkvision
cf create-service-key visualrecognition-for-darkvision for-darkvision

VISUAL_RECOGNITION_CREDENTIALS=`cf service-key visualrecognition-for-darkvision for-darkvision | tail -n +2`
export WATSON_API_KEY=`echo $VISUAL_RECOGNITION_CREDENTIALS | jq -r .api_key`

# Set the Docker image to use
export DOCKER_EXTRACTOR_NAME=l2fprod/darkvision-extractor-master

# Push app
echo 'Deploying web application...'
cd web
if ! cf app $CF_APP; then
  cf push $CF_APP --hostname $CF_APP
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
  cf push $CF_APP --hostname $CF_APP
  cf delete $OLD_CF_APP -f
fi

# Now move back to root folder to deploy OpenWhisk actions
echo 'Deploying OpenWhisk artifacts...'
cd ..

# Retrieve the OpenWhisk authorization key
CF_ACCESS_TOKEN=`cat ~/.cf/config.json | jq -r .AccessToken | awk '{print $2}'`
OPENWHISK_API_HOST=openwhisk.ng.bluemix.net
OPENWHISK_KEYS=`curl -XPOST -k -d "{ \"accessToken\" : \"$CF_ACCESS_TOKEN\", \"refreshToken\" : \"$CF_ACCESS_TOKEN\" }" \
  -H 'Content-Type:application/json' https://$OPENWHISK_API_HOST/bluemix/v2/authenticate`

SPACE_KEY=`echo $OPENWHISK_KEYS | jq -r '.namespaces[] | select(.name == "'$CF_ORG'_'$CF_SPACE'") | .key'`
SPACE_UUID=`echo $OPENWHISK_KEYS | jq -r '.namespaces[] | select(.name == "'$CF_ORG'_'$CF_SPACE'") | .uuid'`
OPENWHISK_AUTH=$SPACE_UUID:$SPACE_KEY

# Deploy the actions
node deploy.js --apihost $OPENWHISK_API_HOST --auth $OPENWHISK_AUTH --uninstall
node deploy.js --apihost $OPENWHISK_API_HOST --auth $OPENWHISK_AUTH --install
