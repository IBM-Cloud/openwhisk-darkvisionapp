const Cloudant = require('cloudant');
const async = require('async');
const fs = require('fs');

function CloudandStorage(cloudantUrl, cloudantDbName, initializeDatabase) {
  var self = this;

  // Cloudant plans have rate limits.
  // The 'retry' plugin catches error 429 from Cloudant and automatically retries
  const cloudant = Cloudant({
    url: cloudantUrl,
    plugin: 'retry',
    retryAttempts: 10,
    retryTimeout: 500
  }).db;
  const cloudantNoRetry = Cloudant({
    url: cloudantUrl
  }).db;

  let visionDb;
  let uploadDb;

  if (!initializeDatabase) {
    visionDb = cloudant.use(cloudantDbName);
    uploadDb = cloudantNoRetry.use(cloudantDbName);
  } else {
    const prepareDbTasks = [];

    // create the db
    prepareDbTasks.push(
      function (callback) {
        console.log('Creating database...');
        cloudant.create(cloudantDbName, function (err, body) {
          if (err && err.statusCode == 412) {
            console.log('Database already exists');
            callback(null);
          } else if (err) {
            callback(err);
          } else {
            callback(null);
          }
        });
      });

    // use it
    prepareDbTasks.push(
      function (callback) {
        console.log('Setting current database to', cloudantDbName);
        visionDb = cloudant.use(cloudantDbName);
        uploadDb = cloudantNoRetry.use(cloudantDbName);
        callback(null);
      });

    // create design documents
    var designDocuments = require('./cloudant-designs.json');
    designDocuments.docs.forEach(function (doc) {
      prepareDbTasks.push(function (callback) {
        console.log('Creating', doc._id);
        visionDb.insert(doc, function (err, body) {
          if (err && err.statusCode == 409) {
            console.log('Design', doc._id, 'already exists');
            callback(null);
          } else if (err) {
            callback(err);
          } else {
            callback(null);
          }
        });
      });
    });

    async.waterfall(prepareDbTasks, function (err, result) {
      if (err) {
        console.log('Error in database preparation', err);
      }
    });
  }

  // add a new document
  self.insert = function(doc, insertCallback/*err, doc*/) {
    visionDb.insert(doc, function (err, body, headers) {
      insertCallback(err, body);
    });
  }

  // attach a file to a document with a pipe
  self.attach = function(doc, attachmentName, attachmentMimetype, attachCallback/*err, body*/) {
    return uploadDb.attachment.insert(doc._id || doc.id, attachmentName, null, attachmentMimetype, {
        rev: doc._rev || doc.rev
      }, attachCallback);
  }

  // attach a file passed as argument to a document
  self.attachFile = function(doc, attachmentName, data, attachmentMimetype, attachCallback/*err, body*/) {
    visionDb.attachment.insert(doc._id || doc.id, attachmentName, data, attachmentMimetype, {
      rev: doc._rev || doc.rev
    }, attachCallback);
  }

  // read a file attached to a document
  self.read = function(docId, attachmentName) {
    return visionDb.attachment.get(docId, attachmentName);
  }

  // return statistics about processed vs. unprocessed videos
  self.status = function(statusCallback/*err, stats*/) {
    var status = {
      videos: {},
      images: {}
    }

    async.parallel([
      function (callback) {
        visionDb.view("videos", "all", function (err, body) {
          if (body) {
            status.videos.count = body.total_rows;
            status.videos.all = body.rows;
          }
          callback(null);
        });
      },
      function (callback) {
        visionDb.view("videos", "to_be_analyzed", function (err, body) {
          if (body) {
            status.videos.to_be_analyzed = body.total_rows;
          }
          callback(null);
        });
      },
      function (callback) {
        visionDb.view("images", "all", function (err, body) {
          if (body) {
            status.images.count = body.total_rows;
          }
          callback(null);
        });
      },
      function (callback) {
        visionDb.view("images", "to_be_analyzed", function (err, body) {
          if (body) {
            status.images.to_be_analyzed = body.total_rows;
          }
          callback(null);
        });
      },
      function (callback) {
        visionDb.view("images", "total_by_video_id", {
          reduce: true,
          group: true
        }, function (err, body) {
          if (body) {
            status.images.by_video_id = body.rows;
          }
          callback(null);
        });
      },
      function (callback) {
        visionDb.view("images", "processed_by_video_id", {
          reduce: true,
          group: true
        }, function (err, body) {
          if (body) {
            status.images.processed_by_video_id = body.rows;
          }
          callback(null);
        });
      }
    ], function (err, result) {
      statusCallback(err, status);
    });
  }

  // get all standalone images
  self.images = function(callback/*err, images*/) {
    visionDb.view('images', 'standalone', {
      include_docs: true
    }, (err, body) => {
      if (err) {
        callback(err);
      } else {
        callback(null, body.rows.map((doc) => doc.doc));
      }
    });
  }

  // reset one image
  self.imageReset = function(imageId, resetCallback/*err, result*/) {
    async.waterfall([
      function (callback) {
        // get the image
        visionDb.get(imageId, {
          include_docs: true
        }, (err, body) => {
          callback(err, body);
        });
      },
      function (image, callback) {
        console.log("Removing analysis from image...");
        delete image.analysis;
        visionDb.insert(image, (err, body, headers) => {
          callback(err, body);
        });
      }
    ], resetCallback);
  }

  // delete one image
  self.imageDelete = function(imageId, deleteCallback/*err, result*/) {
    async.waterfall([
      function (callback) {
        // get the image
        visionDb.get(imageId, {
          include_docs: true
        }, (err, body) => {
          callback(err, body);
        });
      },
      function (image, callback) {
        console.log("Deleting image...");
        delete image.analysis;
        visionDb.destroy(image._id, image._rev, (err, body) => {
          callback(err, body);
        });
      }
    ], deleteCallback);
  }

  // get all videos
  self.videos = function(videosCallback/*err, videos*/) {
    visionDb.view("videos", "all", {
      include_docs: true
    }, (err, body) => {
      if (err) {
        videosCallback(err);
      } else {
        videosCallback(null, body.rows.map((doc) => doc.doc));
      }
    });
  }

  // get one media
  self.get = function(mediaId, callback/*err, media*/) {
    visionDb.get(mediaId, {
      include_docs: true
    }, callback);
  }

  // get all images for a video
  self.videoImages = function(videoId, callback/*err, images*/) {
    visionDb.view('images', 'by_video_id', {
      key: videoId,
      include_docs: true
    }, (err, body) => {
      if (err) {
        callback(err);
      } else {
        callback(null, body.rows.map((doc) => doc.doc));
      }
    });
  }

  // reset a video
  self.videoReset = function(videoId, resetCallback/*err, result*/) {
    // remove all analysis for the give video
    async.waterfall([
      // get all images for this video
      function (callback) {
        console.log("Retrieving all images for", videoId);
        visionDb.view("images", "by_video_id", {
          key: videoId,
          include_docs: true
        }, function (err, body) {
          callback(err, body ? body.rows : null);
        });
      },
      // delete the images
      function (images, callback) {
        var toBeDeleted = {
          docs: images.map(function (row) {
            return {
              _id: row.doc._id,
              _rev: row.doc._rev,
              _deleted: true
            }
          })
        };
        console.log("Deleting", toBeDeleted.docs.length, "images...");
        if (toBeDeleted.docs.length > 0) {
          visionDb.bulk(toBeDeleted, function (err, body) {
            callback(err);
          });
        } else {
          callback(null);
        }
      },
      // get the video
      function (callback) {
        console.log("Loading video", videoId);
        visionDb.get(videoId, {
          include_docs: true
        }, function (err, body) {
          callback(err, body);
        });
      },
      // remove the thumbnail
      function (video, callback) {
        if (video.hasOwnProperty("_attachments") &&
          video._attachments.hasOwnProperty("thumbnail.jpg")) {
          console.log("Removing thumbnail...");
          visionDb.attachment.destroy(video._id, "thumbnail.jpg", {
            rev: video._rev
          }, function (err, body) {
            callback(err);
          })
        } else {
          callback(null);
        }
      },
      // read the video again (new rev)
      function (callback) {
        console.log("Refreshing video document...");
        visionDb.get(videoId, {
          include_docs: true
        }, function (err, body) {
          callback(err, body);
        });
      }
      ,
      // remove its metadata so it gets re-analyzed
      function (video, callback) {
        console.log("Removing metadata...");
        delete video.metadata;
        delete video.frame_count;
        visionDb.insert(video, function (err, body, headers) {
          callback(err, body);
        });
      }
    ], resetCallback);
  }

  // reset the images within a video
  self.videoImagesReset = function(videoId, resetCallback/*err, result*/) {
    async.waterfall([
      // get all images for this video
      function (callback) {
        console.log("Retrieving all images for", videoId);
        visionDb.view("images", "by_video_id", {
          key: videoId,
          include_docs: true
        }, function (err, body) {
          callback(err, body ? body.rows.map(function(row) { return row.doc }) : null);
        });
      },
      // remove their analysis and save them
      function (images, callback) {
        images.forEach(function(image) {
          delete image.analysis;
        });
        var toBeUpdated = {
          docs: images
        };
        console.log("Updating", toBeUpdated.docs.length, "images...");
        visionDb.bulk(toBeUpdated, function (err, body) {
          callback(err, body);
        });
      },
    ], resetCallback);
  }
}

module.exports = function(cloudantUrl, cloudantDbName, initializeDatabase = false) {
  return new CloudandStorage(cloudantUrl, cloudantDbName, initializeDatabase);
}
