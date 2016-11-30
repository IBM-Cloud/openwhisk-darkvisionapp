#!/bin/bash
#
# Copyright 2016 IBM Corp. All Rights Reserved.
#
# Licensed under the Apache License, Version 2.0 (the “License”);
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#  https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an “AS IS” BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# load configuration variables
source local.env

# capture the namespace where actions will be created
# as we need to pass it to our change listener
CURRENT_NAMESPACE=`wsk property get --namespace | awk '{print $3}'`
echo "Current namespace is $CURRENT_NAMESPACE."

function usage() {
  echo "Usage: $0 [--install,--uninstall,--update,--env]"
}

function install() {
  echo "Creating vision package"
  wsk package create vision

  echo "Adding service credentials as parameter"
  wsk package update vision\
    -p cloudantUrl https://$CLOUDANT_username:$CLOUDANT_password@$CLOUDANT_host\
    -p watsonApiKey $WATSON_API_KEY\
    -p cloudantDbName $CLOUDANT_db

  # we will need to listen to cloudant event
  echo "Binding cloudant"
  # /whisk.system/cloudant
  wsk package bind /whisk.system/cloudant \
    vision-cloudant\
    -p username $CLOUDANT_username\
    -p password $CLOUDANT_password\
    -p host $CLOUDANT_host

  echo "Creating trigger"
  wsk trigger create vision-cloudant-trigger --feed vision-cloudant/changes\
    -p dbname $CLOUDANT_db -p includeDoc false

  echo "Creating actions"
  # timeout for extractor is increased as it needs to download the video,
  # in most cases it won't need all this time
  wsk action create -t 300000 --docker vision/extractor $DOCKER_EXTRACTOR_NAME
  wsk action create vision/analysis analysis.js

  echo "Creating change listener"
  wsk action create vision-cloudant-changelistener changelistener.js\
    -p cloudantUrl https://$CLOUDANT_username:$CLOUDANT_password@$CLOUDANT_host\
    -p cloudantDbName $CLOUDANT_db\
    -p targetNamespace $CURRENT_NAMESPACE

  echo "Enabling change listener"
  wsk rule create vision-rule vision-cloudant-trigger vision-cloudant-changelistener
}

function uninstall() {
  echo "Removing actions..."
  wsk action delete vision/analysis
  wsk action delete vision/extractor

  echo "Removing rule..."
  wsk rule disable vision-rule
  wsk rule delete vision-rule

  echo "Removing change listener..."
  wsk action delete vision-cloudant-changelistener

  echo "Removing trigger..."
  wsk trigger delete vision-cloudant-trigger

  echo "Removing packages..."
  wsk package delete vision-cloudant
  wsk package delete vision

  echo "Done"
  wsk list
}

function update() {
  wsk action update vision-cloudant-changelistener changelistener.js
  wsk action update -t 300000 --docker vision/extractor $DOCKER_EXTRACTOR_NAME
  wsk action update vision/analysis analysis.js
}

function disable() {
  wsk rule disable vision-rule
}

function enable() {
  wsk rule enable vision-rule
}

function showenv() {
  echo CLOUDANT_username=$CLOUDANT_username
  echo CLOUDANT_password=$CLOUDANT_password
  echo CLOUDANT_host=$CLOUDANT_host
  echo WATSON_API_KEY=$WATSON_API_KEY
  echo DOCKER_EXTRACTOR_NAME=$DOCKER_EXTRACTOR_NAME
}

case "$1" in
"--install" )
install
;;
"--uninstall" )
uninstall
;;
"--update" )
update
;;
"--env" )
showenv
;;
"--disable" )
disable
;;
"--enable" )
enable
;;
* )
usage
;;
esac
