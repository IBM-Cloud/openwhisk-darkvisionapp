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
import UIKit
import Alamofire
import SwiftyJSON

///  Loads videos from the API.
class Videos {
  
  let api: API;
  var videos = [Video]();
  
  init(api: API) {
    self.api = api;
    
  }
  
  func load(completionhandler: ((UIBackgroundFetchResult) -> Void)!) {
    api.get("/api/videos",
      onSuccess: { (data) -> Void in
        self.videos = data.map({ (text, video) -> Video in
          return Video(api: self.api, impl: video)
        })
        completionhandler(UIBackgroundFetchResult.NewData)
      },
      onFailure:{ () -> Void in
        completionhandler(UIBackgroundFetchResult.Failed)
      }
    )
  }
  
  func count() -> Int {
    return videos.count;
  }
  
  func videoAt(position: Int) -> Video {
    return videos[position];
  }

}
