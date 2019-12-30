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
    console.info('Initializing HomeController');
    var controller = this;

    controller.data = {
      videos: null,
      images: null,
      showVideos: true,
      showImages: true,
    };

    controller.reload = function() {
      controller.reloadVideos();
      controller.reloadImages();
    };

    controller.reloadVideos = function() {
      VideosService.all().then(function(videos) {
        videos.sort(function(video1, video2) {
          return video1.title.localeCompare(video2.title);
        });
        controller.data.videos = videos;
      });
    };

    controller.reloadImages = function() {
      ImagesService.all().then(function (images) {
        controller.data.images = images;
      });
    };

    controller.resetImage = function(image) {
      ImagesService.reset(image).then(function() {
        controller.reloadImages();
      });
    };

    controller.deleteImage = function(image) {
      ImagesService.delete(image).then(function() {
        controller.reloadImages();
      });
    };

    controller.reload();
  }

  angular.module('app')
    .controller('HomeController', ['$location', 'VideosService', 'ImagesService', HomeController]);

}());
