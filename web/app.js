//------------------------------------------------------------------------------
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//------------------------------------------------------------------------------
var
  express = require('express'),
  app = express(),
  multer = require('multer'),
  upload = multer({
    dest: 'uploads/'
  }),
  cfenv = require('cfenv'),
  fs = require("fs"),
  async = require("async");

// Upload areas and reset/delete for videos and images can be protected by basic authentication
// by configuring ADMIN_USERNAME and ADMIN_PASSWORD environment variables.
var
  auth = require('http-auth'),
  basic = auth.basic({
    realm: "Adminstrative Area"
  }, function (username, password, callback) { // Custom authentication method.
    // Authentication is configured through environment variables.
    // If there are not set, upload is open to all users.
    callback(username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD);
  }),
  authenticator = auth.connect(basic),
  checkForAuthentication = function (req, res, next) {
    if (process.env.ADMIN_USERNAME) {
      console.log("Authenticating call...");
      authenticator(req, res, next);
    } else {
      console.log("No authentication configured");
      next();
    }
  };

//---Deployment Tracker---------------------------------------------------------
require("cf-deployment-tracker-client").track();

// initialize local VCAP configuration
var vcapLocal = null
try {
  require('node-env-file')('../processing/local.env');
  vcapLocal = {
    "services": {
      "cloudant": [
        {
          "credentials": {
            "url": "https://" + process.env.CLOUDANT_username + ":" + process.env.CLOUDANT_password + "@" + process.env.CLOUDANT_host
          },
          "label": "cloudant",
          "name": "cloudant-for-darkvision"
        }
      ]
    }
  };

  if (process.env.OS_PASSWORD) {
    vcapLocal.services["Object-Storage"] = [
      {
        "credentials": {
          "auth_url": process.env.OS_AUTH_URL,
          "projectId": process.env.OS_PROJECT_ID,
          "region": process.env.OS_REGION,
          "username": process.env.OS_USERNAME,
          "password": process.env.OS_PASSWORD,
          "domainId": process.env.OS_DOMAIN_ID
        },
        "label": "Object-Storage",
        "name": "objectstorage-for-darkvision"
      }
    ];
  };
  console.log("Loaded local VCAP", vcapLocal);
} catch (e) {
  console.error("local.env file not found.", e);
}

// get the app environment from Cloud Foundry, defaulting to local VCAP
var appEnvOpts = vcapLocal ? {
  vcap: vcapLocal
} : {}
var appEnv = cfenv.getAppEnv(appEnvOpts);

var osCreds = appEnv.getServiceCreds("objectstorage-for-darkvision");
var fileStore = null;
if (osCreds) {
  var osConfig = {
      provider: 'openstack',
      useServiceCatalog: true,
      useInternal: false,
      keystoneAuthVersion: 'v3',
      authUrl: osCreds.auth_url,
      tenantId: osCreds.projectId,
      domainId: osCreds.domainId,
      username: osCreds.username,
      password: osCreds.password,
      region: osCreds.region
  };
  fileStore = require('./lib/objectstorage')(osConfig);
}

var mediaStorage = require('./lib/cloudantstorage')(
  {
    cloudantUrl: appEnv.getServiceCreds("cloudant-for-darkvision").url,
    cloudantDbName: 'openwhisk-darkvision',
    initializeDatabase: true,
    fileStore: fileStore
  });

/**
 * Returns an image attachment for a given video or image id,
 * such as the thumbnail for a video or the original data for an image.
 */
app.get("/images/:type/:id.jpg", function (req, res) {
  mediaStorage.read(req.params.id, `${req.params.type}.jpg`).pipe(res);
});

/**
 * Returns all standalone images (images not linked to a video)
 */
app.get("/api/images", function (req, res) {
  mediaStorage.images((err, body) => {
    if (err) {
      res.status(500).send({
        error: err
      });
    } else {
      res.send(body);
    }
  });
});

/**
 * Removes the analysis from one image
 */
app.get("/api/images/:id/reset", checkForAuthentication, function (req, res) {
  mediaStorage.imageReset(req.params.id, (err, result) => {
    if (err) {
      console.log(err);
      res.status(500).send({
        error: err
      });
    } else {
      console.log("Done");
      res.send(result);
    }
  });
});

/**
 * Deletes a single image
 */
app.delete("/api/images/:id", checkForAuthentication, function (req, res) {
  mediaStorage.delete(req.params.id, (err, result) => {
    if (err) {
      console.log(err);
      res.status(500).send({
        error: err
      });
    } else {
      console.log("Done");
      res.send(result);
    }
  });
});

/**
 * Returns all videos.
 */
app.get("/api/videos", function (req, res) {
  mediaStorage.videos((err, videos) => {
    if (err) {
      res.status(500).send({
        error: err
      });
    } else {
      res.send(videos);
    }
  });
});

/**
 * Returns the video and its metadata.
 */
app.get("/api/videos/:id", function (req, res) {
  mediaStorage.get(req.params.id, (err, video) => {
    if (err) {
      res.status(500).send({
        error: err
      });
    } else {
      res.send(video);
    }
  });
});

/**
 * Returns a summary of the results for one video.
 * It collects all images and their analysis and keeps only the most relevants.
 */
app.get("/api/videos/:id/summary", function (req, res) {

  // threshold to decide what tags/labels/faces to keep
  var options = {
    minimumFaceOccurrence: 3,
    minimumFaceScore: 0.85,
    minimumFaceScoreOccurrence: 2,
    minimumLabelOccurrence: 5,
    minimumLabelScore: 0.70,
    minimumLabelScoreOccurrence: 1,
    maximumLabelCount: 5,
    minimumKeywordOccurrence: 1,
    minimumKeywordScore: 0.60,
    minimumKeywordScoreOccurrence: 1,
    maximumKeywordCount: 5
  }

  async.waterfall([
    // get the video document
    function (callback) {
        console.log("Retrieving video", req.params.id);
        mediaStorage.get(req.params.id, (err, video) => {
          callback(err, video);
        });
    },
    // get all images for this video
    function (video, callback) {
        console.log("Retrieving images for", video._id);
        mediaStorage.videoImages(video._id, (err, images) => {
          if (err) {
            callback(err);
          } else {
            callback(null, video, images);
          }
        });
    },
    // summarize tags, faces
    function (video, images, callback) {
        // Map faces, keywords, tags to their occurrences.
        // These maps will be used to decide which tags/faces to keep for the video summary
        var peopleNameToOccurrences = {};
        var keywordToOccurrences = {};

        console.log("Sorting analysis for video", video._id);
        images.forEach(function (image) {
          if (image.hasOwnProperty("analysis") && image.analysis.face_detection) {
            image.analysis.face_detection.forEach(function (face) {
              if (face.identity && face.identity.name) {
                if (!peopleNameToOccurrences.hasOwnProperty(face.identity.name)) {
                  peopleNameToOccurrences[face.identity.name] = [];
                }
                peopleNameToOccurrences[face.identity.name].push(face);
                face.image_id = image._id;
                face.image_url = req.protocol + "://" + req.hostname + "/images/image/" + image._id + ".jpg"
                face.timecode = image.frame_timecode;
              }
            });
          }

          if (image.hasOwnProperty("analysis") && image.analysis.image_keywords) {
            image.analysis.image_keywords.forEach(function (keyword) {
              if (!keywordToOccurrences.hasOwnProperty(keyword.class)) {
                keywordToOccurrences[keyword.class] = [];
              }
              keywordToOccurrences[keyword.class].push(keyword);
              keyword.image_id = image._id;
              keyword.image_url = req.protocol + "://" + req.hostname + "/images/image/" + image._id + ".jpg"
              keyword.timecode = image.frame_timecode;
            });
          }
        });

        // Filter a list of occurrences according to the minimum requirements
        function filterOccurrences(occurrences, accessor) {
          Object.keys(occurrences).forEach(function (property) {
            // by default we don't keep it
            var keepIt = false;

            // but with enough occurrences
            if (occurrences[property].length >= accessor.minimumOccurrence) {
              // and the minimum score for at least one occurrence
              var numberOfOccurrencesAboveThreshold = 0;
              occurrences[property].forEach(function (occur) {
                if (accessor.score(occur) >= accessor.minimumScore) {
                  numberOfOccurrencesAboveThreshold = numberOfOccurrencesAboveThreshold + 1;
                }
              });

              // we keep it
              if (numberOfOccurrencesAboveThreshold >= accessor.minimumScoreOccurrence) {
                keepIt = true;
              }
            } else {
              keepIt = false;
            }

            if (!keepIt) {
              delete occurrences[property];
            } else {
              // sort the occurrences, higher score first
              occurrences[property].sort(function (oneOccurrence, anotherOccurrence) {
                return accessor.score(anotherOccurrence) - accessor.score(oneOccurrence);
              });

              // keep only the first one
              occurrences[property] = occurrences[property].slice(0, 1);
            }
          });

          var result = [];
          Object.keys(occurrences).forEach(function (property) {
            result.push({
              occurrences: occurrences[property]
            });
          });

          result.sort(function (oneOccurrence, anotherOccurrence) {
            return accessor.score(anotherOccurrence.occurrences[0]) -
              accessor.score(oneOccurrence.occurrences[0]);
          });

          if (accessor.maximumOccurrenceCount && result.length > accessor.maximumOccurrenceCount) {
            result = result.slice(0, accessor.maximumOccurrenceCount);
          }

          return result;
        }

        console.log("Filtering faces for video", video._id);
        peopleNameToOccurrences = filterOccurrences(peopleNameToOccurrences, {
          score: function (face) {
            return face.identity.score;
          },
          minimumOccurrence: options.minimumFaceOccurrence,
          minimumScore: options.minimumFaceScore,
          minimumScoreOccurrence: options.minimumFaceScoreOccurrence
        });

        // filtering keywords
        console.log("Filtering keywords for video", video._id);
        keywordToOccurrences = filterOccurrences(keywordToOccurrences, {
          score: function (label) {
            return label.score;
          },
          minimumOccurrence: options.minimumKeywordOccurrence,
          minimumScore: options.minimumKeywordScore,
          minimumScoreOccurrence: options.minimumKeywordScoreOccurrence,
          maximumOccurrenceCount: options.maximumKeywordCount
        });

        callback(null, {
          video: video,
          face_detection: peopleNameToOccurrences,
          image_keywords: keywordToOccurrences
        });
    }],
    function (err, result) {
      if (err) {
        res.status(500).send({
          error: err
        });
      } else {
        res.send(result);
      }
    });
});

/**
 * Returns related videos. Currently it is all but the given video
 */
app.get("/api/videos/:id/related", function (req, res) {
  mediaStorage.videos((err, videos) => {
    if (err) {
      res.status(500).send({
        error: err
      });
    } else {
      res.send(videos.filter((video) =>video._id != req.params.id && video.metadata));
    }
  });
});

/**
 * Returns all images for a video, including the analysis for each image.
 */
app.get("/api/videos/:id/images", function (req, res) {
  mediaStorage.videoImages(req.params.id, (err, images) => {
    if (err) {
      res.status(500).send({
        error: err
      });
    } else {
      // get the images document and sort them on the frame_number
      images.sort(function (image1, image2) {
        if (image1.hasOwnProperty("frame_number")) {
          return image1.frame_number - image2.frame_number;
        } else {
          return 0;
        }
      });
      res.send(images);
    }
  });
});

/**
 * Deletes all generated data for one video so that it gets analyzed again.
 */
app.get("/api/videos/:id/reset", checkForAuthentication, function (req, res) {
  mediaStorage.videoReset(req.params.id, (err, result) => {
    if (err) {
      console.log(err);
      res.status(500).send({
        error: err
      });
    } else {
      console.log("Done");
      res.send(result);
    }
  });
});

/**
 * Deletes all generated data for images in the video so that they get analyzed again.
 */
app.get("/api/videos/:id/reset-images", checkForAuthentication, function (req, res) {
  mediaStorage.videoImagesReset(req.params.id, (err, result) => {
    if (err) {
      console.log(err);
      res.status(500).send({
        error: err
      });
    } else {
      console.log("Done");
      res.send(result);
    }
  });
});

// Protects the upload zone with login and password if they are configured
app.use("/upload", checkForAuthentication);

/**
 * Uploads one video
 */
app.post("/upload/video", upload.single("file"), function (req, res) {
  var videoDocument = {
    type: "video",
    source: req.file.originalname,
    title: req.file.originalname,
    createdAt: new Date()
  };
  uploadDocument(videoDocument, "video.mp4", req, res);
});

/**
 * Uploads one image
 */
app.post("/upload/image", upload.single("file"), function (req, res) {
  var frameDocument = {
    type: "image",
    createdAt: new Date()
  };
  uploadDocument(frameDocument, "image.jpg", req, res);
});

function uploadDocument(doc, attachmentName, req, res) {
  mediaStorage.insert(doc, (err, insertedDoc) => {
    if (err) {
      res.status(err.statusCode).send("Error persisting media document");
    } else {
      doc._id = insertedDoc.id;
      doc._rev = insertedDoc.rev;
      console.log("Created new document", doc, "for", req.file);
      fs.createReadStream(req.file.destination + "/" + req.file.filename).pipe(
        mediaStorage.attach(doc, attachmentName, req.file.mimetype, (err, attachedDoc) => {
          console.log("Upload completed");
          fs.unlink(req.file.destination + "/" + req.file.filename);
          if (err) {
            console.log(err.statusCode, err.request);
            mediaStorage.delete(doc, function(deleteErr, deleteResult) {
              res.status(err.statusCode).send("Error saving media attachment");
            });
          } else {
            console.log('Sending', attachedDoc);
            res.send(attachedDoc);
          }
        }));
    }
  });
}

/**
 * Returns an overview of the current state of the processing
 * by looking at the content of the database.
 */
app.get("/api/status", function (req, res) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  mediaStorage.status((err, status) => {
    if (err) {
      res.send(500);
    } else {
      res.send(status);
    }
  })
});

// serve the files out of ./public as our main files
app.use(express.static(__dirname + '/public'));

// start server on the specified port and binding host
app.listen(appEnv.port, "0.0.0.0", function () {
  // print a message when the server starts listening
  console.log("server starting on " + appEnv.url);
});
