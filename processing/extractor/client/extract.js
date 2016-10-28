/**
 * Copyright 2016 IBM Corp. All Rights Reserved.
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
var async = require('async');
var fs = require('fs');
var ffmpeg = require("fluent-ffmpeg");
var tmp = require('tmp');
var rimraf = require('rimraf');

// argv[2] is expected to be the payload JSON object as a string
var payload = JSON.parse(process.argv[2])

console.log("Payload", payload);
var doc = payload.doc;

var extractOptions = {
  videoThumbnailSize: 640
};

function getFps(durationInSeconds) {
  // this gives around 15 images per video
  return "1/" + Math.ceil(durationInSeconds / 15);

  // for a more complete analysis,
  // use this code that will extract up to 100 images
  /*
  if (durationInSeconds <= 10) {
    return "2/1"; // 2 images per seconds
  } else if (durationInSeconds > 10 && durationInSeconds <= 100) {
    return "1/1"; // 1 image per seconds
  } else {
    return "1/" + Math.ceil(durationInSeconds / 100);
  }
  */
}

var visionDb = require('cloudant')({
  url: payload.cloudantUrl,
  plugin: 'retry',
  retryAttempts: 10,
  retryTimeout: 500
}).db.use(payload.cloudantDbName);

var attachmentDb = require('cloudant')({
  url: payload.cloudantUrl
}).db.use(payload.cloudantDbName);

// create a temporary directory to process the video
var workingDirectory = tmp.dirSync({
  prefix: 'extractor-' + doc._id
});
// plan to clean up temp directories
tmp.setGracefulCleanup();
console.log("Using temp dir", workingDirectory.name);

var framesDirectory = workingDirectory.name + "/frames";
fs.mkdirSync(framesDirectory);

var videoDocument;
var inputFilename = workingDirectory.name + "/video.mp4";

async.waterfall([
  // load the document from the database
  function (callback) {
      visionDb.get(doc._id, {
        include_docs: true
      }, function (err, body, headers) {
        if (err) {
          callback(err);
        } else {
          videoDocument = body;
          console.log("Video is", videoDocument);

          // if metadata exists we consider this document as already processed and do nothing
          if (videoDocument.metadata) {
            callback("already processed");
          } else {
            callback(null);
          }
        }
      });
  },
  // save its video attachment to disk
  function (callback) {
      console.log("Downloading video attachment...");
      var videoStream = fs.createWriteStream(inputFilename)

      var totalSize = videoDocument._attachments["video.mp4"].length;
      var currentSize = 0;
      var lastProgress = undefined;

      attachmentDb.attachment.get(videoDocument._id, "video.mp4")
        .on('data', function (data) {
          currentSize += data.length

          var progress = Math.round(currentSize * 100 / totalSize);
          if (progress != lastProgress && progress % 5 == 0) {
            console.log('Downloaded', progress, "% (", currentSize, "/", totalSize, ")");
            lastProgress = progress;
          }
        })
        .pipe(videoStream)
        .on("finish", function () {
          videoStream.end();
          console.log("write complete");
          callback(null);
        })
        .on("error", function (err) {
          videoStream.end();
          console.log("error while writing", err);
          callback(err);
        });
  },
  // extract metata
  function (callback) {
      ffmpeg.ffprobe(inputFilename, function (err, metadata) {
        if (!err) {
          videoDocument.metadata = metadata;
          console.log("Extracted video metadata", videoDocument);
        }
        callback(err);
      });
  },
  // persist the videoDocument with its metadata
  function (callback) {
      visionDb.insert(videoDocument, function (err, body, headers) {
        if (err) {
          callback(err);
        } else {
          videoDocument._rev = body.rev;
          callback(null);
        }
      });
  },
  // split frames
  function (callback) {
      var fps = getFps(videoDocument.metadata.streams[0].duration);
      console.log("FPS", fps);

      ffmpeg()
        .input(inputFilename)
        .outputOptions([
      '-filter:v',
      'fps=fps=' + fps
    ])
        .output(framesDirectory + "/%0d.jpg")
        .on('progress', function (progress) {
          console.log('Processing: ' + Math.round(progress.percent) + '% done');
        })
        .on('error', function (err) {
          console.log("split frames", err);
          callback(err);
        })
        .on('end', function () {
          callback(null);
        })
        .run();
  },
  // persist frames
  function (callback) {
      var fps = getFps(videoDocument.metadata.streams[0].duration);
      var timeBetweenFrame = 1 / eval(fps)

      fs.readdir(framesDirectory, function (err, files) {
        var uploadFrames = [];
        files.forEach(function (file) {
          uploadFrames.push(function (callback) {
            console.log("Persist", file);
            var frameDocument = {
              type: "image",
              createdAt: new Date(),
              video_id: videoDocument._id,
              frame_number: parseInt(file, 10),
              frame_timecode: parseInt(file, 10) * timeBetweenFrame
            }
            createDocument(frameDocument, "image.jpg", "image/jpeg", framesDirectory + "/" + file, callback);
          })
        });

        // keep track of the number of frames we extracted
        videoDocument.frame_count = uploadFrames.length

        async.parallelLimit(uploadFrames, 5, function (err, result) {
          callback(err);
        });
      });
  },
  // persist the frame count
  function (callback) {
      visionDb.insert(videoDocument, function (err, body, headers) {
        if (err) {
          callback(err);
        } else {
          videoDocument._rev = body.rev;
          callback(null);
        }
      });
  },
  // pick one frame as preview for the video
  function (callback) {
      fs.readdir(framesDirectory, function (err, files) {
        // use the frame in the middle
        var candidate = files[Math.ceil(files.length / 2)];

        console.log("Candidate is ", framesDirectory + "/" + candidate);
        // convert it to the right size
        ffmpeg()
          .input(framesDirectory + "/" + candidate)
          .outputOptions([
            "-vf scale=" + extractOptions.videoThumbnailSize + ":-1"
          ])
          .output(workingDirectory.name + "/thumbnail.jpg")
          .on('error', function (err) {
            console.log("Error processing thumbnail");
            callback(err);
          })
          .on('end', function () {
            console.log("End of thumbnail processing");
            callback(null);
          })
          .run();
      });
  },
  // attach it to the video
  function (callback) {
      console.log("Attaching thumbnail to video");
      fs.readFile(workingDirectory.name + "/thumbnail.jpg", function(err, data) {
        visionDb.attachment.insert(videoDocument._id, "thumbnail.jpg", data, "image/jpeg", {
          rev: videoDocument._rev
        }, function (err, body) {
          console.log("Video thumbnail result", body);
          if (err) {
            console.log(err.statusCode, err.request);
            callback(err);
          } else {
            callback(null, body);
          }
        });
      });
  }
  ],
  function (err, result) {
    if (err) {
      console.log("Waterfall failed with", err);
    } else {
      console.log("Waterfall completed successfully");
    }

    console.log("Removing temp directory");
    rimraf.sync(workingDirectory.name);
  });

function createDocument(frameDocument, attachmentName, attachmentMimetype, attachmentFile, callback) {
  console.log("Persisting", frameDocument.type);
  visionDb.insert(frameDocument, function (err, body, headers) {
    if (err) {
      console.log("error saving image", err);
      callback(err);
    } else {
      frameDocument = body;
      console.log("Created new document", frameDocument);

      fs.readFile(attachmentFile, function(err, data) {
        visionDb.attachment.insert(frameDocument.id, attachmentName, data, attachmentMimetype, {
          rev: frameDocument.rev
        }, function (err, body) {
          console.log("Upload completed", body);
          if (err) {
            console.log(err.statusCode, err.request);
            callback(err);
          } else {
            callback(null);
          }
        });
      });
    }
  });
}
