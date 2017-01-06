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
 *   "seq": "2-g1AAMNCzw5SiMA1Du_HQi8L_RQteAoMZf4GVgissQ",
 *   "id": "1documentation22d01513-c30f-417b-8c27-56b3c0de12ac",
 *   "changes": [{
 *     "rev": "1-967a00dff5e02add41819138abb3284d"
 *   }]
 * }
 * or
 * {
 *   "seq": "3-g1AAAgb6CTrgCTAU2RdXOqyy",
 *   "id": "1documentation22d01513-c30f-417b-8c27-56b3c0de12ac",
 *   "changes": [{
 *     "rev": "2-eec205a9d413992850a6e32678485900"
 *   }],
 *   "deleted": true
 * }
 */
function main(event) {
  console.log('[', event.id, '] Document change detected');

  // nothing to do on deletion event
  if (event.deleted) {
    console.log('[', event.id, '] OK - ignored, deleted');
    return { ok: true };
  }

  return new Promise((resolve, reject) => {
    onDocumentChange(
      event.cloudantUrl, event.cloudantDbName,
      event.id, event.changes[0].rev, (err, result) => {
        if (err) {
          reject({ ok: false });
        } else {
          resolve(result);
        }
      }
    );
  });
}

exports.main = main;

function onDocumentChange(url, dbName, documentId, documentRev, callback) {
  const mediaStorage = require('./lib/cloudantstorage')({
    cloudantUrl: url,
    cloudantDbName: dbName
  });
  mediaStorage.get(documentId, (err, doc) => {
    if (err) {
      console.log('[', documentId, '] KO', err);
      callback(err);
      return;
    }

    // if the document has already changed in between,
    // ignore this change event, another one should be coming
    // or was processed already
    if (doc._rev !== documentRev) {
      console.log('[', doc._id, '] OK - ignored, document has changed - event rev:',
        documentRev, 'database rev:', doc._rev);
      callback(null, { ok: true, has_changed: true });
      return;
    }

    // if it is a video, it has a 'video.mp4' attachment and it has no metadata,
    if (doc.type === 'video' && mediaStorage.isReadyToProcess(doc)) {
      // trigger the frame-extractor
      asyncCallAction('vision/extractor', doc, callback);
      return;
    }

    // if this is an image, with an attachment and no analysis
    if (doc.type === 'image' && mediaStorage.isReadyToProcess(doc)) {
      // trigger the analysis
      asyncCallAction('vision/analysis', doc, callback);
      return;
    }

    // nothing to do with this change
    console.log('[', doc._id, '] OK - ignored');
    callback(null, { ok: true, ignored: true });
  });
}


function asyncCallAction(anActionName, aDoc, callback) {
  console.log('[', aDoc._id, '] Calling', anActionName);
  const openwhisk = require('openwhisk');
  const whisk = openwhisk({ ignore_certs: true });
  whisk.actions.invoke({
    actionName: anActionName,
    params: {
      doc: aDoc
    },
    blocking: false
  }).then((result) => {
    console.log('[', aDoc._id, ']', anActionName, '[OK]', result);
    callback(null, { ok: true });
  }).catch((error) => {
    console.log('[', aDoc._id, ']', anActionName, '[KO]', error);
    callback(error);
  });
}
