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
const express = require('express');
const multer = require('multer');
const cfenv = require('cfenv');
const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');
const async = require('async');
const auth = require('http-auth');
const compression = require('compression');

const app = express();
app.use(compression());

const upload = multer({
  dest: 'uploads/'
});

// Upload areas and reset/delete for videos and images can be protected by basic authentication
// by configuring ADMIN_USERNAME and ADMIN_PASSWORD environment variables.
const basic = auth.basic({
  realm: 'Adminstrative Area'
}, (username, password, callback) => { // Custom authentication method.
    // Authentication is configured through environment variables.
    // If there are not set, upload is open to all users.
  callback(username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD);
});
const authenticator = auth.connect(basic);
const checkForAuthentication = (req, res, next) => {
  if (process.env.ADMIN_USERNAME) {
    console.log('Authenticating call...');
    authenticator(req, res, next);
  } else {
    console.log('No authentication configured');
    next();
  }
};

// initialize local VCAP configuration
let vcapLocal = null;
if (!fs.existsSync('../local.env')) {
  console.log('No local.env defined. VCAP_SERVICES will be used.');
} else {
  try {
    require('node-env-file')('../local.env');
    vcapLocal = {
      services: {
        cloudantNoSQLDB: [
          {
            credentials: {
              url: 'https://' + process.env.CLOUDANT_username + ':' + process.env.CLOUDANT_password + '@' + process.env.CLOUDANT_host // eslint-disable-line prefer-template
            },
            label: 'cloudantNoSQLDB',
            name: 'cloudant-for-darkvision'
          }
        ]
      }
    };

    if (process.env.COS_API_KEY) {
      vcapLocal.services['cloud-object-storage'] = [
        {
          credentials: {
            apikey: process.env.COS_API_KEY,
            resource_instance_id: process.env.COS_INSTANCE_ID,
          }
        }
      ];
    }

    console.log('Loaded local VCAP', vcapLocal);
  } catch (e) {
    console.error(e);
  }
}

// get the app environment from Cloud Foundry, defaulting to local VCAP
const appEnvOpts = vcapLocal ? {
  vcap: vcapLocal
} : {};
const appEnv = cfenv.getAppEnv(appEnvOpts);

let fileStore;
if (appEnv.services['cloud-object-storage']) {
  const cosCreds = appEnv.services['cloud-object-storage'][0].credentials;
  fileStore = require('./lib/cloudobjectstorage')({
    endpoint: process.env.COS_ENDPOINT,
    apikey: cosCreds.apikey,
    instanceId: cosCreds.resource_instance_id,
    bucket: process.env.COS_BUCKET,
  });
}

const mediaStorage = require('./lib/cloudantstorage')(
  {
    cloudantUrl: appEnv.services.cloudantNoSQLDB[0].credentials.url,
    cloudantDbName: process.env.CLOUDANT_db || 'openwhisk-darkvision',
    initializeDatabase: true,
    fileStore
  });

// setup a cache directory for images
const apiCacheDirectory = `${__dirname}/cache/api`;
const imageCacheDirectory = `${__dirname}/cache/images`;
mkdirp.sync(apiCacheDirectory);
mkdirp.sync(imageCacheDirectory);

if (process.env.USE_API_CACHE) {
  console.log('API calls will be cached in', apiCacheDirectory);
} else {
  console.log('API caching is disabled. Set USE_API_CACHE environment variable to "true" to enable');
}
console.log('Images will be cached in', imageCacheDirectory);

// track cached images
const imageCache = new (require('node-cache'))({
  stdTTL: 60 * 60 * 12, // cached for 12 hours
  checkperiod: 60 * 60, // cleanup every hour
});

// remove image file from disk on cache expiry,
// so that we don't fill up the disk over time
imageCache.on('del', (key) => {
  console.log('Cleaning up cache entry', key);
  const imageFilename = `${imageCacheDirectory}/${key}`;
  fs.unlink(imageFilename);
});

function withJsonApiCaching(req, res, cacheKey, builder /** req, callback(err, result)*/) {
  // if the web-browser is asking for fresh content (shift or ctrl + F5)
  const forceReload =
    (req.headers['cache-control'] && req.headers['cache-control'].indexOf('no-cache') >= 0) ||
    (req.headers.pragma && req.headers.pragma.indexOf('no-cache') >= 0);

  const cachedResultFilename = `${apiCacheDirectory}/${encodeURIComponent(cacheKey)}.json`;
  if (process.env.USE_API_CACHE && !forceReload && fs.existsSync(cachedResultFilename)) {
    console.log('Cache hit for', cacheKey, '->', cachedResultFilename);
    res.sendFile(cachedResultFilename);
  } else {
    builder(req, (err, result, canCache = true) => {
      if (err) {
        res.status(500).send({ ok: false });
      } else {
        if (process.env.USE_API_CACHE && canCache) {
          const cachedResultStream = fs.createWriteStream(cachedResultFilename);
          cachedResultStream.write(JSON.stringify(result, null, '  '), 'utf8');
          cachedResultStream.end();
          console.log('Cached', cacheKey, 'at', cachedResultFilename);
        }
        res.send(result);
      }
    });
  }
}

/**
 * Returns an image attachment for a given video or image id,
 * such as the thumbnail for a video or the original data for an image.
 *
 * To reduce the load on the storage, images are cached locally.
 */
app.get('/images/:type/:id.jpg', (req, res) => {
  const cacheKey = `${encodeURIComponent(req.params.type)}-${encodeURIComponent(req.params.id)}.jpg`;
  const imageFilename = `${imageCacheDirectory}/${cacheKey}`;
  if (imageCache.get(cacheKey)) {
    // cache hit, send the file
    res.sendFile(imageFilename);
  } else {
    const mediaStream = mediaStorage.read(req.params.id, `${req.params.type}.jpg`);
    const imageFile = fs.createWriteStream(imageFilename);

    mediaStream.on('response', (response) => {
      // get the image from the storage
      if (response.statusCode !== 200) {
        res.status(response.statusCode).send({ ok: false });
      }
    })
    .pipe(imageFile)
    .on('error', (err) => {
      console.log('Can not cache image', err);
      res.status(500).send({ ok: false });
    })
    .on('finish', () => {
      console.log('Image cached at', imageFilename);
      res.sendFile(imageFilename);
      imageCache.set(cacheKey, true);
    });
  }
});

/**
 * Returns the video attachment for embedded player
 */
app.get('/videos/stream/:id.mp4', (req, res) => {
  const mediaStream = mediaStorage.read(req.params.id, 'video.mp4');
  mediaStream.pipe(res).on('error', (err) => {
    console.log('Can not read video', err);
    res.status(500).send({ ok: false });
  });
});

/**
 * Returns all standalone images (images not linked to a video)
 */
app.get('/api/images', (req, res) => {
  withJsonApiCaching(req, res, 'images', (request, callback) => {
    mediaStorage.images((err, body) => callback(err, body));
  });
});

/**
 * Removes the analysis from one image
 */
app.post('/api/images/:id/reset', checkForAuthentication, (req, res) => {
  mediaStorage.imageReset(req.params.id, (err, result) => {
    if (err) {
      console.log(err);
      res.status(500).send({
        error: err
      });
    } else {
      console.log('Done');
      res.send(result);
    }
  });
});

/**
 * Deletes a single image
 */
app.delete('/api/images/:id', checkForAuthentication, (req, res) => {
  mediaStorage.delete(req.params.id, (err, result) => {
    if (err) {
      console.log(err);
      res.status(500).send({
        error: err
      });
    } else {
      console.log('Done');
      res.send(result);
    }
  });
});

/**
 * Returns all videos.
 */
app.get('/api/videos', (req, res) => {
  withJsonApiCaching(req, res, 'videos', (request, callback) => {
    mediaStorage.videos((err, videos) => callback(err, videos));
  });
});

/**
 * Returns a summary of the results for one video.
 * It collects all images and their analysis and keeps only the most relevants.
 */
app.get('/api/videos/:id', (req, res) => {
  withJsonApiCaching(req, res, `video-${req.params.id}`, (request, cachingCallback) => {
    // threshold to decide what tags/labels/faces to keep
    const options = {
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
      maximumKeywordCount: 5,
      minimumEntityScore: 0.55,
      minimumConceptScore: 0.55
    };

    async.waterfall([
      // get the video document
      (callback) => {
        console.log('Retrieving video', req.params.id);
        mediaStorage.get(req.params.id, (err, video) => {
          callback(err, video);
        });
      },
      // get all images for this video
      (video, callback) => {
        console.log('Retrieving images for', video._id);
        mediaStorage.videoImages(video._id, (err, images) => {
          if (err) {
            callback(err);
          } else {
            console.log('Got images');
            images.sort((image1, image2) =>
              (image1.frame_number ? image1.frame_number - image2.frame_number : 0));
            callback(null, video, images);
          }
        });
      },
      // summarize tags, faces
      (video, images, callback) => {
        // Map faces, keywords, tags to their occurrences.
        // These maps will be used to decide which tags/faces to keep for the video summary
        let peopleNameToOccurrences = {};
        let keywordToOccurrences = {};

        console.log('Sorting analysis for video', video._id);
        images.forEach((image) => {
          if (image.analysis && image.analysis.face_detection) {
            image.analysis.face_detection.forEach((face) => {
              if (face.identity && face.identity.name) {
                if (!peopleNameToOccurrences[face.identity.name]) {
                  peopleNameToOccurrences[face.identity.name] = [];
                }
                peopleNameToOccurrences[face.identity.name].push(face);
                face.image_id = image._id;
                face.image_url = `${req.protocol}://${req.hostname}/images/image/${image._id}.jpg`;
                face.timecode = image.frame_timecode;
              }
            });
          }

          if (image.analysis && image.analysis.image_keywords) {
            image.analysis.image_keywords.forEach((keyword) => {
              if (!keywordToOccurrences[keyword.class]) {
                keywordToOccurrences[keyword.class] = [];
              }
              keywordToOccurrences[keyword.class].push(keyword);
              keyword.image_id = image._id;
              keyword.image_url = `${req.protocol}://${req.hostname}/images/image/${image._id}.jpg`;
              keyword.timecode = image.frame_timecode;
            });
          }
        });

        // Filter a list of occurrences according to the minimum requirements
        function filterOccurrences(occurrences, accessor) {
          Object.keys(occurrences).forEach((property) => {
            // by default we don't keep it
            let keepIt = false;

            // but with enough occurrences
            if (occurrences[property].length >= accessor.minimumOccurrence) {
              // and the minimum score for at least one occurrence
              let numberOfOccurrencesAboveThreshold = 0;
              occurrences[property].forEach((occur) => {
                if (accessor.score(occur) >= accessor.minimumScore) {
                  numberOfOccurrencesAboveThreshold += 1;
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
              occurrences[property].sort((oneOccurrence, anotherOccurrence) =>
                accessor.score(anotherOccurrence) - accessor.score(oneOccurrence)
              );

              // keep only the first one
              occurrences[property] = occurrences[property].slice(0, 1);
            }
          });

          const result = [];
          Object.keys(occurrences).forEach((property) => {
            result.push(occurrences[property][0]);
          });

          result.sort((oneOccurrence, anotherOccurrence) =>
            accessor.score(anotherOccurrence) - accessor.score(oneOccurrence)
          );

          return result;
        }

        console.log('Filtering faces for video', video._id);
        peopleNameToOccurrences = filterOccurrences(peopleNameToOccurrences, {
          score: face => face.identity.score,
          minimumOccurrence: options.minimumFaceOccurrence,
          minimumScore: options.minimumFaceScore,
          minimumScoreOccurrence: options.minimumFaceScoreOccurrence
        });

        // filtering keywords
        console.log('Filtering keywords for video', video._id);
        keywordToOccurrences = filterOccurrences(keywordToOccurrences, {
          score: label => label.score,
          minimumOccurrence: options.minimumKeywordOccurrence,
          minimumScore: options.minimumKeywordScore,
          minimumScoreOccurrence: options.minimumKeywordScoreOccurrence,
          maximumOccurrenceCount: options.maximumKeywordCount
        });
        // remove the color tags from the overview, they are not interesting in this context
        keywordToOccurrences = keywordToOccurrences.filter(keyword => !keyword.class.endsWith(' color'));

        callback(null, {
          video,
          images,
          face_detection: peopleNameToOccurrences,
          image_keywords: keywordToOccurrences,
        });
      },
      // get the video transcript
      (result, callback) => {
        console.log('Retrieving transcript');
        mediaStorage.videoAudio(result.video._id, (err, audio) => {
          if (err) {
            callback(err);
          } else {
            if (audio && audio.analysis && audio.analysis.nlu) {
              if (audio.analysis.nlu.keywords) {
                audio.analysis.nlu.keywords = audio.analysis.nlu.keywords
                  .filter(keyword => keyword.relevance > options.minimumKeywordScore);
                audio.analysis.nlu.keywords.sort((oneOccurrence, anotherOccurrence) =>
                  anotherOccurrence.relevance - oneOccurrence.relevance
                );
              }
              if (audio.analysis.nlu.entities) {
                audio.analysis.nlu.entities = audio.analysis.nlu.entities
                  .filter(entity => entity.relevance > options.minimumEntityScore);
                audio.analysis.nlu.entities.sort((oneOccurrence, anotherOccurrence) =>
                  anotherOccurrence.relevance - oneOccurrence.relevance
                );
              }
              if (audio.analysis.nlu.concepts) {
                audio.analysis.nlu.concepts = audio.analysis.nlu.concepts
                  .filter(entity => entity.relevance > options.minimumConceptScore);
                audio.analysis.nlu.concepts.sort((oneOccurrence, anotherOccurrence) =>
                  anotherOccurrence.relevance - oneOccurrence.relevance
                );
              }
            }
            result.audio = audio;
            callback(null, result);
          }
        });
      }], (err, result) => {
      // can we cache this video?
      // yes if all of its elements have been processed
      let canCache = false;
      try {
        canCache =
          // video was extracted
          result.video.hasOwnProperty('metadata') &&
          // all images where analyzed
          (result.images.filter(image => !image.hasOwnProperty('analysis')).length === 0) &&
          // audio has been processed
          result.audio.hasOwnProperty('analysis');
      } catch (canCacheError) {
        console.log('Video can not be cached yet.', canCacheError);
      }
      cachingCallback(err, result, canCache);
    });
  });
});

/**
 * Returns related videos. Currently it is all but the given video
 */
app.get('/api/videos/:id/related', (req, res) => {
  mediaStorage.videos((err, videos) => {
    if (err) {
      res.status(500).send({
        error: err
      });
    } else {
      res.send(videos.filter(video => video._id !== req.params.id && video.metadata));
    }
  });
});

/**
 * Deletes all generated data for one video so that it gets analyzed again.
 */
app.post('/api/videos/:id/reset', checkForAuthentication, (req, res) => {
  mediaStorage.videoReset(req.params.id, (err, result) => {
    if (err) {
      console.log(err);
      res.status(500).send({
        error: err
      });
    } else {
      console.log('Done');
      res.send(result);
    }
  });
});

/**
 * Deletes all generated data for images in the video so that they get analyzed again.
 */
app.post('/api/videos/:id/reset-images', checkForAuthentication, (req, res) => {
  mediaStorage.videoImagesReset(req.params.id, (err, result) => {
    if (err) {
      console.log(err);
      res.status(500).send({
        error: err
      });
    } else {
      console.log('Done');
      res.send(result);
    }
  });
});

/**
 * Deletes all generated data for images in the video so that they get analyzed again.
 */
app.post('/api/videos/:id/reset-audio', checkForAuthentication, (req, res) => {
  mediaStorage.videoAudioReset(req.params.id, (err, result) => {
    if (err) {
      console.log(err);
      res.status(500).send({
        error: err
      });
    } else {
      console.log('Done');
      res.send(result);
    }
  });
});

/**
 * Deletes a video and its related objects
 */
app.delete('/api/videos/:id', checkForAuthentication, (req, res) => {
  mediaStorage.videoDelete(req.params.id, (err, result) => {
    if (err) {
      console.log(err);
      res.status(500).send({
        error: err
      });
    } else {
      console.log('Done');
      res.send(result);
    }
  });
});

// Protects the upload zone with login and password if they are configured
app.use('/upload', checkForAuthentication);

app.get('/upload', (req, res) => {
  res.sendStatus(200);
});

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file || !req.file.mimetype) {
    res.status(500).send({ error: 'no file or mimetype' });
  } else if (req.file.mimetype.startsWith('video/')) {
    const videoDocument = {
      type: 'video',
      source: req.file.originalname,
      // remove extension from the filename to build the title
      title: req.body.title || path.parse(req.file.originalname).name,
      language_model: req.body.language_model,
      createdAt: new Date()
    };
    uploadDocument(videoDocument, 'video.mp4', req, res);
  } else if (req.file.mimetype.startsWith('image/')) {
    const frameDocument = {
      type: 'image',
      createdAt: new Date()
    };
    uploadDocument(frameDocument, 'image.jpg', req, res);
  } else {
    res.status(500).send({ error: `unknown mimetype ${req.file.mimetype}` });
  }
});

function uploadDocument(doc, attachmentName, req, res) {
  mediaStorage.insert(doc, (err, insertedDoc) => {
    if (err) {
      res.status(err.statusCode).send('Error persisting media document');
    } else {
      doc._id = insertedDoc.id;
      doc._rev = insertedDoc.rev;
      console.log('Created new document', doc, 'for', req.file);
      fs.createReadStream(`${req.file.destination}/${req.file.filename}`).pipe(
        mediaStorage.attach(doc, attachmentName, req.file.mimetype, (attachErr, attachedDoc) => {
          console.log('Upload completed');
          fs.unlink(`${req.file.destination}/${req.file.filename}`);
          if (attachErr) {
            console.log(attachErr);
            mediaStorage.delete(doc, () => {
              res.status(500).send('Error saving media attachment');
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
app.get('/api/status', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  mediaStorage.status((err, status) => {
    if (err) {
      res.sendStatus(500);
    } else {
      res.send(status);
    }
  });
});

// serve the files out of ./public as our main files
app.use(express.static(require('path').join(__dirname, '/public')));

// start server on the specified port and binding host
app.listen(appEnv.port, '0.0.0.0', () => {
  // print a message when the server starts listening
  console.log(`server starting on ${appEnv.url}`);
});
