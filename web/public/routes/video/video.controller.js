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

    controller.data = {
      video: {},
      images: [],
      summary: {},
      selected: null,
      selectedSummary: null,
    };
    controller.data.videoId = $stateParams.videoId;

    controller.facePositionAsPercent = function(faceLocation, image){
      console.log(faceLocation);
      const result = {
        top: (100 * faceLocation.top / image.analysis.size.height).toFixed(2),
        left: (100 * faceLocation.left / image.analysis.size.width).toFixed(2),
        width: (100 * faceLocation.width / image.analysis.size.width).toFixed(2),
        height: (100 * faceLocation.height / image.analysis.size.height).toFixed(2),
      };
      console.log(result);
      return result;
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

    controller.isVideo = function() {
      return controller.data.selected && controller.data.selected.type === 'video';
    }

    VideosService.get($stateParams.videoId).then(function (video) {
      controller.data.video = video;
      controller.data.selected = video;
    });

    VideosService.images($stateParams.videoId).then(function (images) {
      controller.data.images = images;
      controller.data.notProcessed = images.filter(image => image.analysis === null).length;
    });

    VideosService.summary($stateParams.videoId).then(function (summary) {
      controller.data.summary = summary;
      if (controller.data.video === controller.data.selected) {
        controller.data.selectedSummary = summary;
      }
    });

    controller.reset = function () {
      if (controller.data.selected && controller.data.selected.type === 'image') {
        console.log('Resetting image', controller.data.selected._id);
        ImagesService.reset(controller.data.selected).then(function (targetImage) {
        });
        controller.selectVideo();
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
  }

  angular.module('app')
    .controller('VideoController', ['$location', 'VideosService', 'ImagesService', '$stateParams', '$state', VideoController]);
}());
