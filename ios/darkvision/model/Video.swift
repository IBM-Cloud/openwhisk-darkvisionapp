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
import SwiftyJSON
import SwiftMoment

class Video {
  
  let api: API;
  let impl: JSON;
  var summaryImpl: JSON?;
  var relatedVideos: [Video]?
  
  let starRating : Double
  let viewCount : Int
  
  init(api: API, impl: JSON) {
    self.api = api;
    self.impl = impl;
    
    let titleCount = impl["title"].stringValue.characters.count
    starRating = Double(titleCount % 4) + 1
    viewCount = (titleCount % 7) * 1000 + titleCount
  }
  
  func load(completionhandler: ((UIBackgroundFetchResult) -> Void)!) {
    // its summary
    api.get("/api/videos/" + impl["_id"].string! + "/summary",
      onSuccess: { (data) -> Void in
        self.summaryImpl = data;
        completionhandler(UIBackgroundFetchResult.NewData);
      },
      onFailure: { () -> Void in
        completionhandler(UIBackgroundFetchResult.Failed)
    })
    
    // its related videos
    api.get("/api/videos/" + impl["_id"].string! + "/related",
      onSuccess: { (data) -> Void in
        self.relatedVideos = [Video]()
        for item in data.array! {
          self.relatedVideos?.append(Video(api: self.api, impl: item))
        }
        completionhandler(UIBackgroundFetchResult.NewData);
      },
      onFailure: { () -> Void in
        completionhandler(UIBackgroundFetchResult.Failed)
    })
  }
  
  func title() -> String {
    return impl["title"].string!;
  }
  
  func thumbnailUrl() -> String {
    return api.apiUrl + "/images/thumbnail/" + impl["_id"].string! + ".jpg";
  }
  
  func duration() -> String {
    if (impl["metadata"].isExists()) {
      let durationInSeconds = impl["metadata"]["streams"].array![0]["duration"].doubleValue
      let hours = floor(durationInSeconds/(60*60))
      let minutes = floor((durationInSeconds/60) - hours * 60)
      let seconds = floor(durationInSeconds - (minutes * 60) - (hours * 60 * 60));
      return String(format: "%02d:%02d", Int(minutes), Int(seconds))
    } else {
      return ""
    }
  }
  
  func createdAgo() -> String {
    // "createdAt": "2016-01-21T13:38:16.132Z",
    let dateFormatter: NSDateFormatter = NSDateFormatter()
    dateFormatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSZ";
    let createdAt: NSDate? = dateFormatter.dateFromString(impl["createdAt"].string!)
    return createdAt!.timeAgoSinceNow();
  }
  
  func tags() -> [JSON] {
    var result : [JSON] = []
    if (summaryImpl != nil) {
      for occurrence in summaryImpl!["visual_recognition"].array! {
        result.append(occurrence["occurrences"].array![0])
      }
    }
    return result
  }
  
  func keywords() -> [JSON] {
    var result : [JSON] = []
    if (summaryImpl != nil) {
      for occurrence in summaryImpl!["image_keywords"].array! {
        result.append(occurrence["occurrences"].array![0])
      }
    }
    return result
  }
  
  func faceCount() -> Int {
    return summaryImpl == nil ? 0 : summaryImpl!["face_detection"].count;
  }
  
  func faceAt(position: Int) -> Face {
    return Face(impl: summaryImpl!["face_detection"][position]["occurrences"][0])
  }
  
  func relatedVideoCount() -> Int {
    return relatedVideos == nil ? 0 : relatedVideos!.count
  }
  
  func relatedVideoAt(position: Int) -> Video {
    return relatedVideos![position]
  }
  
}
