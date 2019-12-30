#!/bin/bash
set -e
# set -x

ibmcloud logout

set -o allexport
source pipeline.env
# set +o allexport

# extract region from https://api.us-south.cf.cloud.ibm.com
export REGION=$(echo $CF_TARGET_URL | awk -F '.' '{print $2}')
echo "Region is $REGION"

ibmcloud login -r $REGION --apikey "$PIPELINE_BLUEMIX_API_KEY"
ibmcloud target --cf-api "$CF_TARGET_URL" -o "$CF_ORG" -s "$CF_SPACE" -g "$RESOURCE_GROUP"

################################################################
# Install dependencies
################################################################
echo 'Installing dependencies...'
sudo apt-get -qq update 1>/dev/null
sudo apt-get -qq install jq 1>/dev/null
sudo apt-get -qq install figlet 1>/dev/null

# figlet 'Node.js'

echo 'Installing nvm (Node.js Version Manager)...'
if npm 2>/dev/null; then
  npm config delete prefix
fi
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.35.2/install.sh | bash
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

if [ -z "$CLOUDANT_SERVICE_PLAN" ]; then
  CLOUDANT_SERVICE_PLAN=Lite
fi
if ! ibmcloud resource service-instance cloudant-for-darkvision; then
  ibmcloud resource service-instance-create \
    cloudant-for-darkvision \
    cloudantnosqldb $CLOUDANT_SERVICE_PLAN $REGION \
    -p '{"legacyCredentials":true}'
  ibmcloud resource service-alias-create \
    cloudant-for-darkvision \
    --instance-name cloudant-for-darkvision \
    -s $CF_SPACE
fi
if ! ibmcloud resource service-key cloudant-for-darkvision; then
  ibmcloud resource service-key-create cloudant-for-darkvision Manager --instance-name cloudant-for-darkvision
fi
CLOUDANT_CREDENTIALS=$(ibmcloud resource service-key cloudant-for-darkvision --output JSON | jq .[0])
export CLOUDANT_username=$(echo $CLOUDANT_CREDENTIALS | jq -r .credentials.username)
export CLOUDANT_password=$(echo $CLOUDANT_CREDENTIALS | jq -r .credentials.password)
export CLOUDANT_host=$(echo $CLOUDANT_CREDENTIALS | jq -r .credentials.host)

# Cloudant database should be set by the pipeline, use a default if not set
if [ -z "$CLOUDANT_db" ]; then
  echo "CLOUDANT_db was not set in the pipeline. Using default value."
  export CLOUDANT_db=openwhisk-darkvision
fi

echo 'Creating '$CLOUDANT_db' database...'
# ignore "database already exists error"
curl -s -X PUT "https://$CLOUDANT_username:$CLOUDANT_password@$CLOUDANT_host/$CLOUDANT_db"

# Create Watson Visual Recognition service unless WATSON_API_KEY is defined in the service
figlet -f small 'Visual Recognition'
if [ -z "$WATSON_API_KEY" ]; then
  if [ -z "$VISUAL_RECOGNITION_PLAN" ]; then
    echo 'VISUAL_RECOGNITION_PLAN was not set in the pipeline. Using default value.'
    VISUAL_RECOGNITION_PLAN=lite
  fi

  if ! ibmcloud resource service-instance visualrecognition-for-darkvision; then
    ibmcloud resource service-instance-create visualrecognition-for-darkvision watson-vision-combined $VISUAL_RECOGNITION_PLAN $REGION
  fi
  if ! ibmcloud resource service-key visualrecognition-for-darkvision; then
    ibmcloud resource service-key-create visualrecognition-for-darkvision Manager --instance-name visualrecognition-for-darkvision
  fi
  VISUAL_RECOGNITION_CREDENTIALS=$(ibmcloud resource service-key visualrecognition-for-darkvision --output JSON | jq .[0])
  export WATSON_API_KEY=$(echo $VISUAL_RECOGNITION_CREDENTIALS | jq -r .credentials.apikey)
else
  echo 'Using configured API key for Watson Visual Recognition service'
fi

# Create Watson Speech to Text service
figlet -f small 'Speech to Text'
if ! ibmcloud resource service-instance speechtotext-for-darkvision; then
  ibmcloud resource service-instance-create speechtotext-for-darkvision speech-to-text lite $REGION
fi
if ! ibmcloud resource service-key speechtotext-for-darkvision; then
  ibmcloud resource service-key-create speechtotext-for-darkvision Manager --instance-name speechtotext-for-darkvision
fi
STT_CREDENTIALS=$(ibmcloud resource service-key speechtotext-for-darkvision --output JSON | jq .[0])
export STT_USERNAME=apikey
export STT_PASSWORD=$(echo $STT_CREDENTIALS | jq -r .credentials.apikey)
export STT_URL=$(echo $STT_CREDENTIALS | jq -r .credentials.url)

# Create Watson Natural Language Understanding
figlet -f small 'Natural Language Understanding'
if ! ibmcloud resource service-instance nlu-for-darkvision; then
  ibmcloud resource service-instance-create nlu-for-darkvision natural-language-understanding free $REGION
fi
if ! ibmcloud resource service-key nlu-for-darkvision; then
  ibmcloud resource service-key-create nlu-for-darkvision Manager --instance-name nlu-for-darkvision
fi
NLU_CREDENTIALS=$(ibmcloud resource service-key nlu-for-darkvision --output JSON | jq .[0])
export NLU_USERNAME=apikey
export NLU_PASSWORD=$(echo $NLU_CREDENTIALS | jq -r .credentials.apikey)
export NLU_URL=$(echo $NLU_CREDENTIALS | jq -r .credentials.url)

# Create Cloud Object Storage service
figlet -f small 'Cloud Object Storage'
if [ -z "$COS_BUCKET" ]; then
  export COS_BUCKET=$IDS_PROJECT_NAME-bucket
fi
if [ -z "$COS_SERVICE_PLAN" ]; then
  COS_SERVICE_PLAN=Lite
fi
if [ -z "$COS_API_KEY" ]; then
  if ! ibmcloud resource service-instance cos-for-darkvision; then
    ibmcloud resource service-instance-create cos-for-darkvision cloud-object-storage $COS_SERVICE_PLAN global
    ibmcloud resource service-alias-create \
    cos-for-darkvision \
    --instance-name cos-for-darkvision \
    -s $CF_SPACE
  else
    echo "Cloud Object Storage instance already exists"
  fi
  if ! ibmcloud resource service-key cos-for-darkvision; then
    ibmcloud resource service-key-create cos-for-darkvision Manager --instance-name cos-for-darkvision
  else
    echo "Cloud Object Storage service key already exists"
  fi
  COS_CREDENTIALS=$(ibmcloud resource service-key cos-for-darkvision --output JSON | jq .[0])
  export COS_API_KEY=$(echo $COS_CREDENTIALS | jq -r .credentials.apikey)
  export COS_INSTANCE_ID=$(echo $COS_CREDENTIALS | jq -r .credentials.resource_instance_id)
  COS_ENDPOINTS=$(echo $COS_CREDENTIALS | jq -r .credentials.endpoints)
  COS_ENDPOINTS_JSON=$(curl $COS_ENDPOINTS)
  export COS_ENDPOINT=$(echo $COS_ENDPOINTS_JSON | jq -r --arg REGION "$REGION" '.["service-endpoints"].regional | .[$REGION].public | .[$REGION]')
  echo "COS_ENDPOINT for $REGION is $COS_ENDPOINT"
fi

ibmcloud plugin install -f cloud-object-storage
if ! ibmcloud cos head-bucket --bucket $COS_BUCKET --region $REGION; then
  ibmcloud cos create-bucket --bucket $COS_BUCKET --ibm-service-instance-id $COS_INSTANCE_ID --class Standard --region $REGION
else
  echo "Cloud Object Storage bucket $COS_BUCKET already exists"
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

if ! ibmcloud fn namespace get darkvision; then
  ibmcloud fn namespace create darkvision
fi
NAMESPACE_ID=$(ibmcloud fn namespace get darkvision --properties | grep ID | awk '{print $2}')
ibmcloud fn property set --namespace $NAMESPACE_ID
FUNCTIONS_HOST=$(ibmcloud fn property get --apihost | awk -F '\t' '{print $3}')
export STT_CALLBACK_URL="https://${FUNCTIONS_HOST}/api/v1/web/${NAMESPACE_ID}/vision/speechtotext"

# Deploy the actions
figlet -f small 'Uninstall'
ibmcloud fn list
node deploy.js --apihost $FUNCTIONS_HOST --auth $PIPELINE_BLUEMIX_API_KEY --namespace $NAMESPACE_ID --uninstall
figlet -f small 'Install'
node deploy.js --apihost $FUNCTIONS_HOST --auth $PIPELINE_BLUEMIX_API_KEY --namespace $NAMESPACE_ID --install

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

if ! ibmcloud cf app $CF_APP; then
  ibmcloud cf push $CF_APP -i $CF_APP_INSTANCES --hostname $CF_APP_HOSTNAME --no-start
  ibmcloud cf set-env $CF_APP CLOUDANT_db "${CLOUDANT_db}"
  ibmcloud cf set-env $CF_APP COS_ENDPOINT "${COS_ENDPOINT}"
  ibmcloud cf set-env $CF_APP COS_BUCKET "${COS_BUCKET}"
  if [ ! -z "$USE_API_CACHE" ]; then
    ibmcloud cf set-env $CF_APP USE_API_CACHE true
  fi
  if [ -z "$ADMIN_USERNAME" ]; then
    echo 'No admin username configured'
  else
    ibmcloud cf set-env $CF_APP ADMIN_USERNAME "${ADMIN_USERNAME}"
    ibmcloud cf set-env $CF_APP ADMIN_PASSWORD "${ADMIN_PASSWORD}"
  fi
  ibmcloud cf start $CF_APP
else
  OLD_CF_APP=${CF_APP}-OLD-$(date +"%s")
  rollback() {
    set +e
    if ibmcloud cf app $OLD_CF_APP; then
      ibmcloud cf logs $CF_APP --recent
      ibmcloud cf delete $CF_APP -f
      ibmcloud cf rename $OLD_CF_APP $CF_APP
    fi
    exit 1
  }
  set -e
  trap rollback ERR
  figlet -f small 'Deploy new version'
  ibmcloud cf rename $CF_APP $OLD_CF_APP
  ibmcloud cf push $CF_APP -i $CF_APP_INSTANCES --hostname $CF_APP_HOSTNAME --no-start
  ibmcloud cf set-env $CF_APP CLOUDANT_db "${CLOUDANT_db}"
  ibmcloud cf set-env $CF_APP COS_ENDPOINT "${COS_ENDPOINT}"
  ibmcloud cf set-env $CF_APP COS_BUCKET "${COS_BUCKET}"
  if [ ! -z "$USE_API_CACHE" ]; then
    ibmcloud cf set-env $CF_APP USE_API_CACHE true
  fi
  if [ -z "$ADMIN_USERNAME" ]; then
    echo 'No admin username configured'
  else
    ibmcloud cf set-env $CF_APP ADMIN_USERNAME "${ADMIN_USERNAME}"
    ibmcloud cf set-env $CF_APP ADMIN_PASSWORD "${ADMIN_PASSWORD}"
  fi
  ibmcloud cf start $CF_APP
  figlet -f small 'Remove old version'
  ibmcloud cf delete $OLD_CF_APP -f
fi

figlet -f slant 'Job done!'
