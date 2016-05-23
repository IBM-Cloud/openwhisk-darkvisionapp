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

/**
 * Called by Whisk.
 * 
 * It expects the following parameters as attributes of "args"
 * - cloudantUrl: "https://username:password@host"
 * - cloudantDbName: "openwhisk-darkvision"
 * - alchemyKey: "123456"
 * - watsonUsername: "username"
 * - watsonPassword: "password"
 * - doc: "image document in cloudant"
 */
function main(args) {
  if (mainImpl(args, function (err, result) {
      if (err) {
        whisk.error(err);
      } else {
        whisk.done(result, null);
      }
    })) {
    return whisk.async();
  }
}

/**
 * Uses a callback so that this same code can be imported in another JavaScript
 * to test the function outside of OpenWhisk.
 * 
 * mainCallback(err, analysis)
 */
function mainImpl(args, mainCallback) {
  var fs = require('fs')
  var request = require('request')

  var startTime = (new Date).getTime();

  if (args.hasOwnProperty("doc")) {
    var imageDocumentId = args.doc._id;
    console.log("[", imageDocumentId, "] Processing image.jpg from document");
    var nano = require("nano")(args.cloudantUrl);
    var visionDb = nano.db.use(args.cloudantDbName);

    // use image id to build a unique filename
    var fileName = imageDocumentId + "-image.jpg";

    var async = require('async')
    async.waterfall([
      // get the image document from the db
      function (callback) {
        visionDb.get(imageDocumentId, {
          include_docs: true
        }, function (err, image) {
          callback(err, image);
        });
      },
      // get the image binary
      function (image, callback) {
        visionDb.attachment.get(image._id, "image.jpg").pipe(fs.createWriteStream(fileName))
          .on("finish", function () {
            callback(null, image);
          })
          .on("error", function (err) {
            callback(err);
          });
      },
      // trigger the analysis on the image file
      function (image, callback) {
        processImage(args, fileName, function (err, analysis) {
          if (err) {
            callback(err);
          } else {
            callback(null, image, analysis);
          }
        });
      },
      // write result in the db
      function (image, analysis, callback) {
        image.analysis = analysis
        visionDb.insert(image, function (err, body, headers) {
          if (err) {
            callback(err);
          } else {
            callback(null, analysis);
          }
        });
      }
    ], function (err, analysis) {
      var durationInSeconds = ((new Date).getTime() - startTime) / 1000;
      
      if (err) {
        console.log("[", imageDocumentId, "] KO (", durationInSeconds, "s)", err);
        mainCallback(err);
      } else {
        console.log("[", imageDocumentId, "] OK (", durationInSeconds, "s)");
        mainCallback(null, analysis);
      }
    });
    return true;
  } else {
    console.log("Parameter 'doc' not found", args);
    mainCallback("Parameter 'doc' not found");
    return false;
  }
}

/**
 * Prepares and analyzes the image.
 * processCallback = function(err, analysis);
 */
function processImage(args, fileName, processCallback) {
  prepareImage(fileName, function (prepareErr, prepareFileName) {
    if (prepareErr) {
      processCallback(prepareErr, null);
    } else {
      analyzeImage(args, prepareFileName, function (err, analysis) {
        var fs = require('fs');
        fs.unlink(prepareFileName);
        processCallback(err, analysis);
      });
    }
  });
}

/**
 * Prepares the image, resizing it if it is too big for Watson or Alchemy.
 * prepareCallback = function(err, fileName);
 */
function prepareImage(fileName, prepareCallback) {
  var
    fs = require('fs'),
    async = require('async'),
    gm = require('gm').subClass({
      imageMagick: true
    });

  async.waterfall([
    function (callback) {
      // Retrieve the file size
      fs.stat(fileName, function (err, stats) {
        if (err) {
          callback(err);
        } else {
          callback(null, stats);
        }
      });
    },
    // Check if size is OK
    function (fileStats, callback) {
      if (fileStats.size > 900 * 1024) {
        // Resize the file
        gm(fileName).define("jpeg:extent=900KB").write(fileName + ".jpg",
          function (err) {
            if (err) {
              callback(err);
            } else {
              // Process the modified file
              callback(null, fileName + ".jpg");
            }
          });
      } else {
        callback(null, fileName);
      }
    }
  ], function (err, fileName) {
    prepareCallback(err, fileName);
  });
}

/**
 * Analyzes the image stored at fileName with the callback onAnalysisComplete(err, analysis).
 * analyzeCallback = function(err, analysis);
 */
function analyzeImage(args, fileName, analyzeCallback) {
  var
    request = require('request'),
    async = require('async'),
    fs = require('fs'),
    gm = require('gm').subClass({
      imageMagick: true
    }),
    analysis = {};

  async.parallel([
    function (callback) {
        // Write down meta data about the image
        gm(fileName).size(function (err, size) {
          if (err) {
            console.log("Image size", err);
          } else {
            analysis.size = size;
          }
          callback(null);
        });
    },
    function (callback) {
        // Call AlchemyAPI Face Detection passing the image in the request
        fs.createReadStream(fileName).pipe(
          request({
              method: "POST",
              url: "https://access.alchemyapi.com/calls" +
                "/image/ImageGetRankedImageFaceTags" +
                "?apikey=" + args.alchemyKey +
                "&imagePostMode=raw" +
                "&outputMode=json" +
                "&knowledgeGraph=1",
              headers: {
                'Content-Length': fs.statSync(fileName).size
              },
              json: true

            },
            function (err, response, body) {
              if (err) {
                console.log("Face Detection", err);
              } else {
                analysis.face_detection = body;
              }
              callback(null);
            }))
    },
    function (callback) {
        // Call AlchemyAPI Image Keywords passing the image in the request
        fs.createReadStream(fileName).pipe(
          request({
              method: "POST",
              url: "https://access.alchemyapi.com/calls" +
                "/image/ImageGetRankedImageKeywords" +
                "?apikey=" + args.alchemyKey +
                "&imagePostMode=raw" +
                "&outputMode=json" +
                "&knowledgeGraph=1",
              headers: {
                'Content-Length': fs.statSync(fileName).size
              },
              json: true

            },
            function (err, response, body) {
              if (err) {
                console.log("Image Keywords", err);
              } else {
                analysis.image_keywords = body;
                // make the imageKeywords array if Alchemy did not return any tag
                if (analysis.image_keywords.hasOwnProperty("imageKeywords") &&
                  analysis.image_keywords.imageKeywords.length == 1 &&
                  analysis.image_keywords.imageKeywords[0].text == "NO_TAGS") {
                  analysis.image_keywords.imageKeywords = [];
                }
              }
              callback(null);
            }))
    },
    function (callback) {
        // Call Watson Visual Recognition passing the image in the request
        var params = {
          image_file: fs.createReadStream(fileName)
        }

        var watson = require('watson-developer-cloud')
        var visual_recognition;
        try {
          // this is the watson_developer_cloud 0.9.29 SDK
          visual_recognition = watson.visual_recognition({
            username: args.watsonUsername,
            password: args.watsonPassword,
            version: 'v1'
          });
        } catch (err) {
          // this is for most recent versions
          visual_recognition = watson.visual_recognition({
            username: args.watsonUsername,
            password: args.watsonPassword,
            version: 'v1-beta'
          });
        }

        visual_recognition.recognize(params, function (err, body) {
          if (err) {
            console.log("Watson", err);
          } else {
            analysis.visual_recognition = body;
          }
          callback(null);
        });
    }
  ],
    function (err, result) {
      analyzeCallback(err, analysis);
    }
  )
}
