/**
 * Copyright 2018 IBM Corp. All Rights Reserved.
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

const COS = require('ibm-cos-sdk');
const stream = require('stream');

function CloudObjectStorage(cosConfig, initializeStorageCallback) {
  const self = this;
  self.cosConfig = cosConfig;
  self.cos = new COS.S3({
    endpoint: cosConfig.endpoint,
    apiKeyId: cosConfig.apikey,
    serviceInstanceId: cosConfig.instanceId
  });
  self.bucket = cosConfig.bucket;

  // PENDING(fredL) create the bucket if it does not exist
  if (initializeStorageCallback) {
    initializeStorageCallback(null, self);
  }

  self.storageUrl = function() {
    return `https://${self.cosConfig.endpoint}/${self.bucket}`;
  };

  self.write = function(filename) {
    console.log('[cloudobjectstorage]', 'New upload to', filename);

    let filesize = 0;
    const pass = new stream.PassThrough();

    const manager = self.cos.upload({
      Bucket: self.bucket,
      Key: filename,
      Body: pass,
      ACL: 'public-read',
    }, (err/* ,data*/) => {
      if (err) {
        pass.emit('error', err);
      } else {
        pass.emit('success', {
          name: filename,
          size: filesize,
        });
      }
    });

    manager.on('httpUploadProgress', (progress) => {
      filesize = progress.total;
    });

    return pass;
  };

  self.read = function(filename) {
    console.log('[cloudobjectstorage]', 'Read', filename);

    return require('request').get(`${self.storageUrl()}/${filename}`);
  };

  self.delete = function(filename, callback) {
    console.log('[cloudobjectstorage]', 'Delete', filename);

    self.cos.deleteObject({
      Bucket: self.bucket,
      Key: filename,
    }, callback);
  };
}

module.exports = function(cosConfig, initializeStorageCallback/* err, objectStorage*/) {
  return new CloudObjectStorage(cosConfig, initializeStorageCallback);
};
