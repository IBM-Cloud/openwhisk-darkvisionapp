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
(function () {
  function VideoController($location, VideosService, ImagesService, $stateParams, $state) {
    console.info("Initializing VideoController");
    var controller = this;

    controller.showMoreAudio = false;
    controller.showMoreKeywords = false;
    controller.showMoreEntities = false;
    controller.showMoreConcepts = false;

    controller.data = {
      video: null,
      images: null,
      summary: null,
      selected: null,
      selectedSummary: null,
    };
    controller.data.videoId = $stateParams.videoId;

    controller.facePositionAsPercent = function(faceLocation, image){
      return {
        top: (100 * faceLocation.top / image.analysis.size.height).toFixed(2),
        left: (100 * faceLocation.left / image.analysis.size.width).toFixed(2),
        width: (100 * faceLocation.width / image.analysis.size.width).toFixed(2),
        height: (100 * faceLocation.height / image.analysis.size.height).toFixed(2),
      };
    }

    controller.selectVideo = function() {
      console.log('Selecting video');
      controller.data.selected = controller.data.video;
      controller.data.selectedSummary = controller.data.summary;
    };

    controller.selectImage = function(image) {
      console.log('Selecting image', image);
      controller.data.selected = image;
      controller.data.selectedSummary = image.analysis;
    };

    controller.selectImageWithTag = function(tagType, tagName) {
      if (!controller.isVideo()) {
        return;
      }

      var imageWithTag = controller.data.images.find(function(image) {
        if (image.analysis) {
          switch (tagType) {
            case 'face_detection':
              return image.analysis.face_detection.find(function(face) {
                return face.identity && face.identity.name === tagName;
              });
            case 'image_keywords':
              return image.analysis.image_keywords.find(function(keyword) {
                return keyword.class === tagName;
              });
            case 'custom_keywords':
                return image.analysis.custom_keywords.find(function(customKeyword) {
                  return keyword.class === tagName;
              });  
          }
        }
        return false;
      });
      if (imageWithTag) {
        controller.selectImage(imageWithTag);
        // scroll the image to make it visible
        var imageDom = document.getElementById(`image-${imageWithTag._id}`);
        imageDom.scrollIntoView();
      } else {
        console.log('No image found matching', tagType, tagName);
      }
    };


    controller.isVideo = function() {
      return controller.data.selected && controller.data.selected.type === 'video';
    }

    VideosService.get($stateParams.videoId).then(function (summary) {
      controller.data.images = summary.images;
      controller.data.summary = summary;
      controller.data.selected = controller.data.video;
      controller.data.selectedSummary = summary;
      controller.data.video = controller.data.selected = summary.video;
    });

    controller.reset = function() {
      if (controller.data.selected && controller.data.selected.type === 'image') {
        console.log('Resetting image', controller.data.selected._id);
        ImagesService.reset(controller.data.selected).then(function (targetImage) {
          $state.reload();
        });
      } else {
        console.log('Resetting video', controller.data.video._id);
        VideosService.reset(controller.data.video._id).then(function (reset) {
          // reload the page, it will show empty
          $state.reload();
        });
      }
    };

    controller.resetImages = function() {
      VideosService.resetImages(controller.data.video._id).then(function (reset) {
        // reload the page, it will show empty
        $state.reload();
      });
    }

    controller.resetAudio = function() {
      VideosService.resetAudio(controller.data.video._id).then(function (reset) {
        // reload the page, it will show empty
        $state.reload();
      });
    }

    controller.delete = function() {
      if (controller.data.selected && controller.data.selected.type === 'image') {
        var idToRemove = controller.data.selected._id;
        console.log('Deleting image', idToRemove);
        ImagesService.delete(controller.data.selected).then(function (targetImage) {
          controller.data.images = controller.data.images.filter(function(image) {
            return image._id !== idToRemove;
          });
        });
        controller.selectVideo();
      } else {
        console.log('Deleting video', controller.data.video._id);
        VideosService.delete(controller.data.video._id).then(function (reset) {
          // go back home
          $state.go('home');
        });
      }
    };
  }

  angular.module('app')
    .controller('VideoController', ['$location', 'VideosService', 'ImagesService', '$stateParams', '$state', VideoController]);
}());
