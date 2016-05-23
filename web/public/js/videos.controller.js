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
  function VideosController($location, VideosService, $stateParams) {
    console.info("Initializing VideosController");
    var controller = this;

    controller.data = {
      videos: []
    };

    controller.reload = function () {
      VideosService.all().then(function (videos) {
        videos.sort(function(video1, video2) {
          return video1.title.localeCompare(video2.title);
        });
        controller.data.videos = videos;
      });
    };
    
    $("#uploadVideoZone").dropzone({
      parallelUploads: 1,
      uploadMultiple: false,
      acceptedFiles: "video/*",
      dictDefaultMessage: "Drop Videos here to upload"
    }).on("success", function (file, responseText) {
      controller.reload();
    });
    
    controller.reload();
  }

  angular.module('app')
    .controller('VideosController', ['$location', 'VideosService', '$stateParams', VideosController]);

}());
