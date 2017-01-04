const Cloudant = require('cloudant');
const async = require('async');

function CloudandStorage(options) {
  const self = this;

  // Cloudant plans have rate limits.
  // The 'retry' plugin catches error 429 from Cloudant and automatically retries
  const cloudant = Cloudant({
    url: options.cloudantUrl,
    plugin: 'retry',
    retryAttempts: 10,
    retryTimeout: 500
  }).db;
  const cloudantNoRetry = Cloudant({
    url: options.cloudantUrl
  }).db;

  let visionDb;
  let uploadDb;
  const fileStore = options.fileStore;

  if (!options.initializeDatabase) {
    visionDb = cloudant.use(options.cloudantDbName);
    uploadDb = cloudantNoRetry.use(options.cloudantDbName);
  } else {
    const prepareDbTasks = [];

    // create the db
    prepareDbTasks.push(
      function (callback) {
        console.log('Creating database...');
        cloudant.create(options.cloudantDbName, function (err, body) {
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
        console.log('Setting current database to', options.cloudantDbName);
        visionDb = cloudant.use(options.cloudantDbName);
        uploadDb = cloudantNoRetry.use(options.cloudantDbName);
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
    if (!doc._id) {
      throw new Error('Need a full document here');
    }

    if (fileStore) {
      // store the file
      console.log('Attaching file to external storage...');
      const filename = `${doc._id}-${attachmentName}`;
      const uploadBucket = fileStore.write(filename);

      uploadBucket.on('error', function(err) {
        attachCallback(err);
      });

      uploadBucket.on('success', function(file) {
        console.log(`Upload complete ${file.name} (${file.size} bytes)`);

        if (!doc.attachments) {
          doc.attachments = {};
        }
        // update the document in cloudant with the pointer to the attachment
        doc.attachments[attachmentName] = {
          content_type: attachmentMimetype,
          length: file.size,
          url: fileStore.storageUrl() + '/' + filename
        };
        visionDb.insert(doc, function(err, body) {
          attachCallback(err, body);
        });
      });

      return uploadBucket;
    } else {
      return uploadDb.attachment.insert(doc._id, attachmentName, null, attachmentMimetype, {
          rev: doc._rev
        }, attachCallback);
    }
  }

  // attach a file passed as argument to a document
  self.attachFile = function(doc, attachmentName, data, attachmentMimetype, attachCallback/*err, body*/) {
    if (fileStore) {
      var stream = require('stream');
      var bufferStream = new stream.PassThrough();
      bufferStream.end(data);
      bufferStream.pipe(self.attach(doc, attachmentName, attachmentMimetype, attachCallback));
    } else {
      visionDb.attachment.insert(doc._id || doc.id, attachmentName, data, attachmentMimetype, {
        rev: doc._rev || doc.rev
      }, attachCallback);
    }
  }

  // return the length of the given attachment
  self.getAttachmentSize = function(doc, attachmentName) {
    if (doc.hasOwnProperty('_attachments')) {
      return doc._attachments[attachmentName].length;
    } else if (doc.hasOwnProperty('attachments')) {
      return doc.attachments[attachmentName].length;
    } else {
      return -1;
    }
  }

  // read a file attached to a document or a URL as a string pointing to the content
  self.read = function(docOrId, attachmentName) {
     // this is a real doc and we detect and external storage, stream from the storage
    if (docOrId.attachments) {
      return require('request').get(docOrId.attachments[attachmentName].url);
    } else if (fileStore) {
      return fileStore.read(`${docOrId}-${attachmentName}`);
    } else {
      return visionDb.attachment.get(docOrId._id || docOrId, attachmentName);
    }
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

  // delete one media
  self.delete = function(mediaId, deleteCallback/*err, result*/) {
    async.waterfall([
      function (callback) {
        // get the image
        visionDb.get(mediaId, {
          include_docs: true
        }, (err, body) => {
          callback(err, body);
        });
      },
      function (doc, callback) {
        console.log("Deleting media...");
        visionDb.destroy(doc._id, doc._rev, (err, body) => {
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

  function hasAttachment(doc, attachmentName) {
    return (doc.hasOwnProperty('attachments') && doc.attachments.hasOwnProperty(attachmentName)) ||
      (doc.hasOwnProperty('_attachments') && doc._attachments.hasOwnProperty(attachmentName));
  }

  // check if a video or image has already been processed
  self.isReadyToProcess = function(doc) {
    try {
      if (doc.type === "video") {
        return hasAttachment(doc, "video.mp4") && !doc.hasOwnProperty("metadata");
      } else if (doc.type === "image") {
        return hasAttachment(doc, "image.jpg") && !doc.hasOwnProperty("analysis");
      } else {
        return false;
      }
    } catch (error) {
      console.log(error);
      return false;
    }
  }

}

module.exports = function(options) {
  return new CloudandStorage(options);
}
