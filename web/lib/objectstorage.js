const pkgcloud = require('pkgcloud');
const async = require('async');

function ObjectStorage(osConfig, initializeStorageCallback/* err, objectStorage*/) {
  const self = this;

  const storageClient = pkgcloud.storage.createClient(osConfig);
  const storageContainerName = 'openwhisk-darkvision';
  let storageContainer;

  async.waterfall([
    // authenticate
    function(callback) {
      storageClient.auth((err) => {
        if (err) {
          callback(err);
        } else {
          console.log('Connected to storage with tenant', storageClient._identity.options.tenantId);
          callback(null);
        }
      });
    },
    // create container
    function(callback) {
      console.log('Creating storage container...');
      storageClient.createContainer({
        name: storageContainerName,
        metadata: {
          'Web-Index': 'index.html'
        }
      }, (err, container) => {
        if (err) {
          callback(err);
        } else {
          console.log('Got container at', container.client._serviceUrl);
          storageContainer = container;
          callback(null);
        }
      });
    },
    // make container public
    function(callback) {
      console.log('Making storage container public...');
      require('request')({
        url: self.storageUrl(),
        method: 'POST',
        headers: {
          'X-Container-Read': '.r:*',
          'X-Auth-Token': storageClient._identity.token.id
        }
      }, (error) => {
        callback(error);
      });
    }
  ], (err) => {
    if (err) {
      console.log(err);
    } else {
      console.log('Storage container is ready at', self.storageUrl());
    }
    if (initializeStorageCallback) {
      initializeStorageCallback(err, self);
    }
  });

  self.storageUrl = function() {
    return `${storageContainer.client._serviceUrl}/${storageContainer.name}`;
  };

  self.write = function(filename) {
    const upload = storageClient.upload({
      container: storageContainerName,
      remote: filename
    });
    // upload.on('error', function(err) { });
    // upload.on('success', function(file) { });
    return upload;
  };

  self.read = function(filename) {
    const download = storageClient.download({
      container: storageContainerName,
      remote: filename
    });
    return download;
  };

  self.delete = function() {
  };
}

module.exports = function(osConfig, initializeStorageCallback/* err, objectStorage*/) {
  return new ObjectStorage(osConfig, initializeStorageCallback);
};
