#!/bin/bash
set -e

# Limit deployments to US South
if [ "$CF_TARGET_URL" != "https://api.ng.bluemix.net" ];
then
  echo "Dark Vision can currently only be deployed to US South region."
  exit 1
fi

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
# Log in
################################################################
bx login -a "$CF_TARGET_URL" --apikey "$IBMCLOUD_API_KEY"
bx target -o "$CF_ORG" -s "$CF_SPACE"

################################################################
# Create services
################################################################
figlet 'Services'

# Create Cloudant service
figlet -f small 'Cloudant'
bx cf create-service cloudantNoSQLDB Lite cloudant-for-darkvision
bx cf create-service-key cloudant-for-darkvision for-darkvision

CLOUDANT_CREDENTIALS=`bx cf service-key cloudant-for-darkvision for-darkvision | tail -n +5`
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
  bx cf create-service watson_vision_combined lite visualrecognition-for-darkvision
  bx cf create-service-key visualrecognition-for-darkvision for-darkvision

  VISUAL_RECOGNITION_CREDENTIALS=`bx cf service-key visualrecognition-for-darkvision for-darkvision | tail -n +5`
  export WATSON_API_KEY=`echo $VISUAL_RECOGNITION_CREDENTIALS | jq -r .apikey`
else
  echo 'Using configured API key for Watson Visual Recognition service'
fi

# Create Watson Speech to Text service
figlet -f small 'Speech to Text'
bx cf create-service speech_to_text standard speechtotext-for-darkvision
bx cf create-service-key speechtotext-for-darkvision for-darkvision

STT_CREDENTIALS=`bx cf service-key speechtotext-for-darkvision for-darkvision | tail -n +5`
export STT_USERNAME=`echo $STT_CREDENTIALS | jq -r .username`
export STT_PASSWORD=`echo $STT_CREDENTIALS | jq -r .password`
export STT_URL=`echo $STT_CREDENTIALS | jq -r .url`

# Create Watson Natural Language Understanding
figlet -f small 'Natural Language Understanding'
bx cf create-service natural-language-understanding free nlu-for-darkvision
bx cf create-service-key nlu-for-darkvision for-darkvision

NLU_CREDENTIALS=`bx cf service-key nlu-for-darkvision for-darkvision | tail -n +5`
export NLU_USERNAME=`echo $NLU_CREDENTIALS | jq -r .username`
export NLU_PASSWORD=`echo $NLU_CREDENTIALS | jq -r .password`
export NLU_URL=`echo $NLU_CREDENTIALS | jq -r .url`

# Create Cloud Object Storage service
figlet -f small 'Cloud Object Storage'
if [ -z "$COS_BUCKET" ]; then
  echo 'No Cloud Object Storage configured, medias will be stored in Cloudant but will be limited in size'
else
  if [ -z "$COS_API_KEY" ]; then
    bx cf create-service cloud-object-storage $COS_PLAN cloudobjectstorage-for-darkvision
    bx cf create-service-key cloudobjectstorage-for-darkvision for-darkvision
    COS_CREDENTIALS=`bx cf service-key cloudobjectstorage-for-darkvision for-darkvision | tail -n +5`
    # COS_ENDPOINT and COS_BUCKET are set from the pipeline, export the others
    export COS_API_KEY=`echo $COS_CREDENTIALS | jq -r .apikey`
    export COS_INSTANCE_ID=`echo $COS_CREDENTIALS | jq -r .resource_instance_id`
    # and let the rest know we created this service
    export USING_TOOLCHAIN_COS=true
  fi

  # create the bucket
  BX_IAM_TOKEN=`bx iam oauth-tokens | grep IAM | awk '{print $4}'`
  curl -X PUT "https://$COS_ENDPOINT/$COS_BUCKET" -H "Authorization: bearer $BX_IAM_TOKEN" -H "ibm-service-instance-id: $COS_INSTANCE_ID"
fi

# Docker image should be set by the pipeline, use a default if not set
if [ -z "$DOCKER_EXTRACTOR_NAME" ]; then
  echo 'DOCKER_EXTRACTOR_NAME was not set in the pipeline. Using default value.'
  export DOCKER_EXTRACTOR_NAME=l2fprod/darkvision-extractor-master
fi

################################################################
# Cloud Functions artifacts
################################################################
figlet 'Cloud Functions'

SAFE_CF_ORG=$(echo ${CF_ORG} | sed 's/ /+/g')
SAFE_CF_SPACE=$(echo ${CF_SPACE} | sed 's/ /+/g')
OPENWHISK_API_HOST=`bx wsk property get --apihost | awk -F '\t' '{print $3}'`

export STT_CALLBACK_URL="https://${OPENWHISK_API_HOST}/api/v1/web/${SAFE_CF_ORG}_${SAFE_CF_SPACE}/vision/speechtotext"
echo 'Speech to Text Cloud Functions action will be accessible at '$STT_CALLBACK_URL

# Deploy the actions
figlet -f small 'Uninstall'
node deploy.js --uninstall
figlet -f small 'Install'
node deploy.js --install

################################################################
# Register the Speech to Text callback URL
################################################################
figlet -f small 'Callback'
node deploy.js --register_callback

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

if ! bx cf app $CF_APP; then
  bx cf push $CF_APP -i $CF_APP_INSTANCES --hostname $CF_APP_HOSTNAME --no-start
  bx cf set-env $CF_APP CLOUDANT_db "${CLOUDANT_db}"
  bx cf set-env $CF_APP COS_ENDPOINT "${COS_ENDPOINT}"
  bx cf set-env $CF_APP COS_BUCKET "${COS_BUCKET}"
  # if the COS was created by the toolchain bind it to the app
  if [ ! -z "$USING_TOOLCHAIN_COS" ]; then
    bx cf bind-service $CF_APP cloudobjectstorage-for-darkvision
  fi
  if [ ! -z "$USE_API_CACHE" ]; then
    bx cf set-env $CF_APP USE_API_CACHE true
  fi
  if [ -z "$ADMIN_USERNAME" ]; then
    echo 'No admin username configured'
  else
    bx cf set-env $CF_APP ADMIN_USERNAME "${ADMIN_USERNAME}"
    bx cf set-env $CF_APP ADMIN_PASSWORD "${ADMIN_PASSWORD}"
  fi
  bx cf start $CF_APP
else
  OLD_CF_APP=${CF_APP}-OLD-$(date +"%s")
  rollback() {
    set +e
    if bx cf app $OLD_CF_APP; then
      bx cf logs $CF_APP --recent
      bx cf delete $CF_APP -f
      bx cf rename $OLD_CF_APP $CF_APP
    fi
    exit 1
  }
  set -e
  trap rollback ERR
  figlet -f small 'Deploy new version'
  bx cf rename $CF_APP $OLD_CF_APP
  bx cf push $CF_APP -i $CF_APP_INSTANCES --hostname $CF_APP_HOSTNAME --no-start
  bx cf set-env $CF_APP CLOUDANT_db "${CLOUDANT_db}"
  bx cf set-env $CF_APP COS_ENDPOINT "${COS_ENDPOINT}"
  bx cf set-env $CF_APP COS_BUCKET "${COS_BUCKET}"
    # if the COS was created by the toolchain bind it to the app
  if [ ! -z "$USING_TOOLCHAIN_COS" ]; then
    bx cf bind-service $CF_APP cloudobjectstorage-for-darkvision
  fi
  if [ ! -z "$USE_API_CACHE" ]; then
    bx cf set-env $CF_APP USE_API_CACHE true
  fi
  if [ -z "$ADMIN_USERNAME" ]; then
    echo 'No admin username configured'
  else
    bx cf set-env $CF_APP ADMIN_USERNAME "${ADMIN_USERNAME}"
    bx cf set-env $CF_APP ADMIN_PASSWORD "${ADMIN_PASSWORD}"
  fi
  bx cf start $CF_APP
  figlet -f small 'Remove old version'
  bx cf delete $OLD_CF_APP -f
fi

figlet -f slant 'Job done!'
