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
 */
function main(doc) {
  console.log("[", doc._id, "] Document change detected for type", doc.type);

  // nothing to do on deletion event
  if (doc._deleted) {
    console.log("[", doc._id, "] Ignored, delete");
    return;
  }

  // if it is a video, it has a "video.mp4" attachment and it has no metadata,
  if (doc.type == "video" &&
      doc.hasOwnProperty("_attachments") &&
      doc._attachments.hasOwnProperty("video.mp4") &&
      !doc.hasOwnProperty("metadata")) {
    // trigger the frame-extractor
    asyncCallAction("/" + doc.targetNamespace +"/vision/extractor", doc);
    return whisk.async();
  }

  // if this is an image, with an attachment and no analysis
  if (doc.type == "image" &&
    !doc.hasOwnProperty("analysis") &&
    doc.hasOwnProperty("_attachments") &&
    doc._attachments.hasOwnProperty("image.jpg")) {
    // trigger the analysis
    asyncCallAction("/" + doc.targetNamespace +"/vision/analysis", doc);
    return whisk.async();
  }
  
}

function asyncCallAction(actionName, doc) {
  console.log("[", doc._id, "] Calling", actionName);
  whisk.invoke({
    name: actionName,
    parameters: {
      doc: doc
    },
    blocking: false,
    next: function (error, activation) {
      if (error) {
        console.log("[", doc._id, "]", actionName, "[error]", error);
      } else {
        console.log("[", doc._id, "]", actionName, "[activation]", activation);
      }
      whisk.done(undefined, error);
    }
  });
}
