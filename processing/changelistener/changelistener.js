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

/**
 * Listens to Cloudant changes and trigger frame extractor and analysis actions.
 *
 * Changes look like:
 * {
 *   "seq": "2-g1AAAAI7eJyN0E0OgjAQBeD6k-gt5ASkRdriSm6iTDuEEIREceFKb6I30ZvoTbBYE-wG2cxMmubLyysIIfNsoomnQVV7jDUEfo2H-kSp8FVRHXVS1n6JdWF-jhMCi6Zp8sxcO_MwQ1AoVuAKrEcAz0xYf5HRBwl1wBjlLhL1IXGLbJwkIQ-kUtJFwj5k2yJnJ0mKS8pFMLyQcmomuZhlnGuXBqiKmKTDe7HQzUL3Doow5Qy0C8m_0MNCzw5SiMA1Du_HQi8L_RQteAoMZf4GVgissQ",
 *   "id": "1documentation22d01513-c30f-417b-8c27-56b3c0de12ac",
 *   "changes": [{
 *     "rev": "1-967a00dff5e02add41819138abb3284d"
 *   }]
 * }
 * or
 * {
 *   "seq": "3-g1AAAAI7eJyN0EsOgjAQBuD6SPQWcgLSIqW4kpso0w4hBCFRXLjSm-hN9CZ6EyyUBLtBNjOTyeTL5M8JIct0poijQJZHjBR4boWn6kJp4Mq8PKu4qNwCq1xfTmMCq7qus1RPB71YIEgMNmALbEAAR1fYdsikRXzlMUa5jYRDSNQgO-sTn3tCSmEj_hCyb5Brh0xbJME15YE3PpBiriu56aade_8NUBkyQcfnYqCHgZ49FGLCGSgbEn-hl4HePSQRgSscn4-BPgb6CTrgCTAU2RdXOqyy",
 *   "id": "1documentation22d01513-c30f-417b-8c27-56b3c0de12ac",
 *   "changes": [{
 *     "rev": "2-eec205a9d413992850a6e32678485900"
 *   }],
 *   "deleted": true
 * }
 */
function main(event) {
  console.log("[", event.id, "] Document change detected");

  // nothing to do on deletion event
  if (event.deleted) {
    console.log("[", event.id, "] OK - ignored, deleted");
    return;
  }

  return new Promise(function(resolve, reject) {
    onDocumentChange(
      event.cloudantUrl, event.cloudantDbName,
      event.id, event.changes[0].rev, function(err, result) {
        if (err) {
          reject({ ok: false});
        } else {
          resolve(result);
        }
      }
    );
  });
}

exports.main = main;

function onDocumentChange(cloudantUrl, cloudantDbName, documentId, documentRev, callback) {
  var mediaStorage = require('./lib/cloudantstorage')(cloudantUrl, cloudantDbName);
  mediaStorage.get(documentId, function (err, doc) {
    if (err) {
      console.log("[", documentId, "] KO", err);
      callback(err);
      return;
    }

    // if the document has already changed in between,
    // ignore this change event, another one should be coming
    // or was processed already
    if (doc._rev !== documentRev) {
      console.log("[", doc._id, "] OK - ignored, document has changed - event rev:",
        documentRev, "database rev:", doc._rev);
      callback(null, { ok: true, has_changed: true });
      return;
    }

    // if it is a video, it has a "video.mp4" attachment and it has no metadata,
    if (doc.type === "video" && mediaStorage.isReadyToProcess(doc)) {
      // trigger the frame-extractor
      asyncCallAction("vision/extractor", doc, callback);
      return;
    }

    // if this is an image, with an attachment and no analysis
    if (doc.type === "image" && mediaStorage.isReadyToProcess(doc)) {
      // trigger the analysis
      asyncCallAction("vision/analysis", doc, callback);
      return;
    }

    // nothing to do with this change
    console.log("[", doc._id, "] OK - ignored");
    callback(null, {ok: true, ignored: true});
  });
}


function asyncCallAction(actionName, doc, callback) {
  console.log("[", doc._id, "] Calling", actionName);
  const openwhisk = require('openwhisk');
  const whisk = openwhisk({ignore_certs: true});
  whisk.actions.invoke({
    actionName: actionName,
    params: {
      doc: doc
    },
    blocking: false
  }).then(function(result) {
    console.log("[", doc._id, "]", actionName, "[OK]", result);
    callback(null, {ok: true});
  }).catch(function(error) {
    console.log("[", doc._id, "]", actionName, "[KO]", error);
    callback(error);
  });
}
