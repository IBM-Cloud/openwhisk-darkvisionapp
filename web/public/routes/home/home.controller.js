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
  function HomeController($location, VideosService, ImagesService) {
    console.info("Initializing HomeController");
    var controller = this;

    controller.data = {
      videos: [],
      images: [],
      showVideos: true,
      showImages: true,
    };

    controller.reload = function () {
      VideosService.all().then(function (videos) {
        videos.sort(function(video1, video2) {
          return video1.title.localeCompare(video2.title);
        });
        controller.data.videos = videos;
      });
      ImagesService.all().then(function (images) {
        controller.data.images = images;
      });
    };

    controller.resizeFactor = function (image) {
      var width = image.analysis.size.width;
      var height = image.analysis.size.height;

      var factor = 1;
      if (width > 300) {
        factor = 300 / width;
      }
      if (height > 200) {
        factor = 200 / height;
      }

      return factor;
    };

    // $("#uploadVideoZone").dropzone({
    //   parallelUploads: 1,
    //   uploadMultiple: false,
    //   acceptedFiles: "video/*",
    //   dictDefaultMessage: "Drop Videos here to upload"
    // }).on("success", function (file, responseText) {
    //   controller.reload();
    // });

    controller.reload();
  }

  angular.module('app')
    .controller('HomeController', ['$location', 'VideosService', 'ImagesService', HomeController]);

}());
