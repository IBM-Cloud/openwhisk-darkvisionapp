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

class Face {

  let impl : JSON
  
  init(impl : JSON) {
    self.impl = impl
  }
  
  func name() -> String {
    if (impl["identity"].isExists()) {
      return impl["identity"]["name"].stringValue
    } else {
      return ""
    }
  }
  
  func age() -> String {
    return impl["age"]["min"].stringValue + "-" + impl["age"]["max"].stringValue
  }
  
  func sourceImageUrl() -> String {
    return impl["image_url"].stringValue
  }
  
  func positionX() -> Int {
    return impl["face_location"]["left"].intValue
  }

  func positionY() -> Int {
    return impl["face_location"]["top"].intValue
  }

  func width() -> Int {
    return impl["face_location"]["width"].intValue
  }

  func height() -> Int {
    return impl["face_location"]["height"].intValue
  }
}
