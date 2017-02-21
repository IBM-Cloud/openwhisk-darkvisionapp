/**
 * Copyright 2017 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the “License”);
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *  https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an “AS IS” BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const openwhisk = require('openwhisk');
const async = require('async');

const argv = require('yargs')
  .command('install', 'Install OpenWhisk actions')
  .command('uninstall', 'Uninstall OpenWhisk actions')
  .command('disable', 'Disable video and image processing')
  .command('enable', 'Enable video and image processing')
  .command('update', 'Update action code')
  .option('apihost', {
    alias: 'a',
    describe: 'OpenWhisk API host',
    type: 'string'
  })
  .option('auth', {
    alias: 'u',
    describe: 'OpenWhisk authorization key',
    type: 'string'
  })
  .count('verbose')
  .alias('v', 'verbose')
  .help()
  .alias('h', 'help')
  .alias('', 'help')
  .argv;

const VERBOSE_LEVEL = argv.verbose;
function WARN(...args) { VERBOSE_LEVEL >= 0 && console.log.apply(console, args); } // eslint-disable-line
function INFO(...args) { VERBOSE_LEVEL >= 1 && console.log.apply(console, args); } // eslint-disable-line
function DEBUG(...args) { VERBOSE_LEVEL >= 2 && console.log.apply(console, args); } // eslint-disable-line

if (!argv.install &&
  !argv.uninstall &&
  !argv.disable &&
  !argv.enable &&
  !argv.update) {
  WARN('No command specified.');
  process.exit(1);
}

// load OpenWhisk CLI configuration if it exists
const wskCliPropsPath = path.join(os.homedir(), '.wskprops');
if (fs.existsSync(wskCliPropsPath)) {
  require('dotenv').config({ path: wskCliPropsPath });
  WARN('Initialized OpenWhisk host and key from', wskCliPropsPath);
}

if (argv.apihost) {
  WARN('OpenWhisk host is set on command line.');
}

if (argv.auth) {
  WARN('OpenWhisk authorization key is set on command line.');
}

// load configuration options
if (fs.existsSync('local.env')) {
  WARN('Loading Dark Vision credentials from local.env');
  require('dotenv').config({ path: 'local.env' });
} else {
  WARN('No local.env found. Dark Vision credentials will be loaded from environment variables.');
}

// load wskprops if any
const openwhiskOptions = {
  apihost: argv.apihost || process.env.APIHOST,
  api_key: argv.auth || process.env.AUTH
};

const openwhiskClient = openwhisk(openwhiskOptions);

if (argv.install) {
  install(openwhiskClient);
} else if (argv.uninstall) {
  uninstall(openwhiskClient);
} else if (argv.disable) {
  disable(openwhiskClient);
} else if (argv.enable) {
  enable(openwhiskClient);
} else if (argv.update) {
  update(openwhiskClient);
}

function install(ow) {
  WARN('Installing artifacts...');
  waterfall([
    //   wsk package create vision
    (callback) => {
      call(ow, 'package', 'create', 'vision', callback);
    },
    //   wsk package update vision\
    //     -p cloudantUrl https://$CLOUDANT_username:$CLOUDANT_password@$CLOUDANT_host\
    //     -p watsonApiKey \
    //     -p cloudantDbName \
    //     -p osAuthUrl "$OS_AUTH_URL"\
    //     -p osProjectId "$OS_PROJECT_ID"\
    //     -p osRegion "$OS_REGION"\
    //     -p osUsername "$OS_USERNAME"\
    //     -p osPassword "$OS_PASSWORD"\
    //     -p osDomainId "$OS_DOMAIN_ID"
    (callback) => {
      const keyAndValues = {
        cloudantUrl: `https://${process.env.CLOUDANT_username}:${process.env.CLOUDANT_password}@${process.env.CLOUDANT_host}`,
        cloudantDbName: process.env.CLOUDANT_db,
        watsonApiKey: process.env.WATSON_API_KEY,
        sttUrl: process.env.STT_URL,
        sttUsername: process.env.STT_USERNAME,
        sttPassword: process.env.STT_PASSWORD,
        sttCallbackSecret: process.env.STT_CALLBACK_SECRET,
        sttCallbackUrl: process.env.STT_CALLBACK_URL,
        alchemyUrl: process.env.ALCHEMY_URL,
        alchemyApiKey: process.env.ALCHEMY_API_KEY,
        osAuthUrl: process.env.OS_AUTH_URL || '',
        osProjectId: process.env.OS_PROJECT_ID || '',
        osRegion: process.env.OS_REGION || '',
        osUsername: process.env.OS_USERNAME || '',
        osPassword: process.env.OS_PASSWORD || '',
        osDomainId: process.env.OS_DOMAIN_ID || '',
      };
      call(ow, 'package', 'update', {
        packageName: 'vision',
        package: {
          parameters: toParameters(keyAndValues)
        }
      }, callback);
    },
    //   wsk package bind /whisk.system/cloudant \
    //     vision-cloudant\
    //     -p username $CLOUDANT_username\
    //     -p password $CLOUDANT_password\
    //     -p host $CLOUDANT_host
    (callback) => {
      const keyAndValues = {
        username: process.env.CLOUDANT_username,
        password: process.env.CLOUDANT_password,
        host: process.env.CLOUDANT_host
      };
      call(ow, 'package', 'create', {
        packageName: 'vision-cloudant',
        package: {
          parameters: toParameters(keyAndValues),
          binding: {
            namespace: 'whisk.system',
            name: 'cloudant'
          }
        }
      }, callback);
    },
    //   wsk trigger create vision-cloudant-trigger --feed vision-cloudant/changes\
    //     -p dbname $CLOUDANT_db
    (callback) => {
      call(ow, 'trigger', 'create', {
        triggerName: 'vision-cloudant-trigger',
        trigger: {
          annotations: [{
            key: 'feed',
            value: 'vision-cloudant/changes'
          }]
        }
      }, callback);
    },
    (callback) => {
      call(ow, 'feed', 'create', {
        feedName: 'vision-cloudant/changes',
        trigger: 'vision-cloudant-trigger',
        params: {
          api_key: openwhiskOptions.api_key,
          dbname: process.env.CLOUDANT_db
        }
      }, callback);
    },
    //   # timeout for extractor is increased as it needs to download the video,
    //   # in most cases it won't need all this time
    //   wsk action create -t 300000 --docker vision/extractor $DOCKER_EXTRACTOR_NAME
    (callback) => {
      call(ow, 'action', 'create', {
        actionName: 'vision/extractor',
        action: {
          exec: {
            kind: 'blackbox',
            code: '',
            image: process.env.DOCKER_EXTRACTOR_NAME
          },
          limits: {
            timeout: 300000
          }
        }
      }, callback);
    },
    makeChangeListenerTask(ow, true),
    makeActionTask(ow, 'textanalysis', true),
    makeActionTask(ow, 'analysis', true),
    makeSpeechToTextTask(ow, true),
    //   wsk rule create vision-rule vision-cloudant-trigger vision-cloudant-changelistener
    (callback) => {
      call(ow, 'rule', 'create', {
        ruleName: 'vision-rule',
        action: 'vision-cloudant-changelistener',
        trigger: 'vision-cloudant-trigger'
      }, callback);
    }
  ]);
}

function makeSpeechToTextTask(ow, isCreate) {
  return makeActionTask(ow, 'speechtotext', isCreate, {
    annotations: [{
      key: 'web-export',
      value: true
    }]
  });
}

function makeActionTask(ow, actionName, isCreate, options = {}) {
  //   wsk action create vision/speechtotext --kind nodejs:6 speechtotext/speechtotext.zip
  return (callback) => {
    const files = {
      'package.json': `processing/${actionName}/package.json`,
      'lib/cloudantstorage.js': 'web/lib/cloudantstorage.js',
      'lib/objectstorage.js': 'web/lib/objectstorage.js',
      'lib/cloudant-designs.json': 'web/lib/cloudant-designs.json'
    };
    files[`${actionName}.js`] = `processing/${actionName}/${actionName}.js`;
    const actionCode = buildZip(files);

    call(ow, 'action', isCreate ? 'create' : 'update', {
      actionName: `vision/${actionName}`,
      action: {
        exec: {
          kind: 'nodejs:6',
          code: actionCode,
          binary: true
        },
        limits: {
          timeout: 300000
        },
        annotations: options.annotations || []
      }
    }, callback);
  };
}

function makeChangeListenerTask(ow, isCreate) {
  //   wsk action create vision-cloudant-changelistener --kind nodejs:6 changelistener/changelistener.zip\
  //     -p cloudantUrl https://$CLOUDANT_username:$CLOUDANT_password@$CLOUDANT_host\
  //     -p cloudantDbName $CLOUDANT_db
  return (callback) => {
    const actionCode = buildZip({
      'package.json': 'processing/changelistener/package.json',
      'changelistener.js': 'processing/changelistener/changelistener.js',
      'lib/cloudantstorage.js': 'web/lib/cloudantstorage.js',
      'lib/objectstorage.js': 'web/lib/objectstorage.js',
      'lib/cloudant-designs.json': 'web/lib/cloudant-designs.json'
    });
    call(ow, 'action', isCreate ? 'create' : 'update', {
      actionName: 'vision-cloudant-changelistener',
      action: {
        exec: {
          kind: 'nodejs:6',
          code: actionCode,
          binary: true
        },
        parameters: [{
          key: 'cloudantUrl',
          value: `https://${process.env.CLOUDANT_username}:${process.env.CLOUDANT_password}@${process.env.CLOUDANT_host}`
        }, {
          key: 'cloudantDbName',
          value: process.env.CLOUDANT_db
        }]
      }
    }, callback);
  };
}

function uninstall(ow) {
  WARN('Uninstalling artifacts...');
  waterfall([
    callback => call(ow, 'action', 'delete', 'vision/analysis', callback),
    callback => call(ow, 'action', 'delete', 'vision/extractor', callback),
    callback => call(ow, 'action', 'delete', 'vision/speechtotext', callback),
    callback => call(ow, 'action', 'delete', 'vision/textanalysis', callback),
    callback => call(ow, 'rule', 'disable', 'vision-rule', callback),
    callback => call(ow, 'rule', 'delete', 'vision-rule', callback),
    callback => call(ow, 'action', 'delete', 'vision-cloudant-changelistener', callback),
    callback => call(ow, 'trigger', 'delete', 'vision-cloudant-trigger', callback),
    (callback) => {
      call(ow, 'feed', 'delete', {
        feedName: 'vision-cloudant/changes',
        trigger: 'vision-cloudant-trigger',
        params: {
          api_key: openwhiskOptions.api_key,
          dbname: process.env.CLOUDANT_db
        }
      }, callback);
    },
    callback => call(ow, 'package', 'delete', 'vision-cloudant', callback),
    callback => call(ow, 'package', 'delete', 'vision', callback)
  ]);
}

function disable(ow) {
  WARN('Disabling video and image processing...');
  waterfall([
    // wsk rule disable vision-rule
    (callback) => {
      call(ow, 'rule', 'disable', 'vision-rule', callback);
    }
  ]);
}

function enable(ow) {
  WARN('Enabling video and image processing...');
  waterfall([
    // wsk rule enable vision-rule
    (callback) => {
      call(ow, 'rule', 'enable', 'vision-rule', callback);
    }
  ]);
}

function update(ow) {
  WARN('Updating action code...');
  waterfall([
    makeChangeListenerTask(ow, false),
    makeActionTask(ow, 'textanalysis', false),
    makeActionTask(ow, 'analysis', false),
    makeSpeechToTextTask(ow, false),
  ]);
}

// call the OpenWhisk client API dynamically
function call(ow, resource, verb, callOptions, callback) {
  let params = callOptions;
  if (typeof callOptions === 'string') {
    params = {};
    params[`${resource}Name`] = callOptions;
  }

  DEBUG(`[${resource} ${verb} ${params[`${resource}Name`]}]`);

  ow[`${resource}s`][verb](params).then(() => {
    WARN(`${resource} ${verb} ${params[`${resource}Name`]} [OK]`);
    callback(null);
  }).catch((err) => {
    WARN(`${resource} ${verb} ${params[`${resource}Name`]} [KO]`, err.message);
    DEBUG(`${resource} ${verb} ${params[`${resource}Name`]} [KO]`, err);
    callback(null);
  });
}

function toParameters(keyAndValues) {
  return Object.keys(keyAndValues).map(key => ({
    key,
    value: keyAndValues[key]
  }));
}

function waterfall(tasks) {
  async.waterfall(tasks, (err) => {
    if (err) {
      DEBUG('Failed', err);
    } else {
      WARN('Done');
    }
  });
}

function buildZip(files) {
  const actionZip = require('node-zip')();
  Object.keys(files).forEach((filename) => {
    actionZip.file(filename, fs.readFileSync(files[filename]));
  });
  return actionZip.generate({ base64: true, compression: 'DEFLATE' });
}
