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
import RDHCollectionViewGridLayout

class VideoDetailController: UICollectionViewController {
  
  var video: Video?
  var videoController: VideoController?
  
  override func viewDidLoad() {
    if let layout = collectionView?.collectionViewLayout as? UICollectionViewFlowLayout {
      let itemWidth = view.bounds.width// / 3.0
      let itemHeight = layout.itemSize.height
      layout.itemSize = CGSize(width: itemWidth, height: itemHeight)
      
      layout.minimumInteritemSpacing = 0
      layout.minimumLineSpacing = 0
      layout.sectionInset = UIEdgeInsetsMake(0, 0, 0, 0)
    }
  }
  
  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
  }
  
  func setVideo(_ video: Video) {
    self.video = video
    collectionView?.reloadData()
  }
  
  
  enum Sections { case faces, relatedVideos }
  
  func section(_ section: Int) -> Sections {
    if (video == nil || (video != nil && video!.faceCount() > 0)) {
      switch (section) {
      case 0:
        return .faces
      default:
        return .relatedVideos
      }
    } else {
      return .relatedVideos
    }
  }
  
  override func numberOfSections(in collectionView: UICollectionView) -> Int {
    if (video == nil || (video != nil && video!.faceCount() > 0)) {
      return 2;
    } else {
      return 1;
    }
  }
  
  override func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int {
    switch (self.section(section)) {
    case .faces:
      return video == nil ? 0 : video!.faceCount()
    case .relatedVideos:
      return video == nil ? 0 : video!.relatedVideoCount()
    }
  }
  
  func collectionView(_ collectionView: UICollectionView, layout collectionViewLayout: UICollectionViewLayout, sizeForItemAtIndexPath indexPath: IndexPath) -> CGSize {
    return CGSize(width: view.bounds.width - 16, height: 112)
  }
  
  override func collectionView(_ collectionView: UICollectionView, viewForSupplementaryElementOfKind kind: String, at indexPath: IndexPath) -> UICollectionReusableView {
    let cell = collectionView.dequeueReusableSupplementaryView(ofKind: kind, withReuseIdentifier: "SectionHeader", for: indexPath) as! VideoSectionHeaderCell
    switch (section((indexPath as NSIndexPath).section)) {
    case .faces:
      cell.sectionTitle.text = "People in the video"
    case .relatedVideos:
      cell.sectionTitle.text = "Related videos"
    }
    return cell
  }
  
  override func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
    // Configure the cell
    switch (section((indexPath as NSIndexPath).section)) {
    case .faces:
      // face
      let cell = collectionView.dequeueReusableCell(withReuseIdentifier: "FaceCell",
        for: indexPath) as! FaceCell
      
      let face = video!.faceAt((indexPath as NSIndexPath).row)
      cell.faceName.text = face.name()
      cell.faceAge.text = face.age()
      cell.faceView.af_setImage(withURL: URL(string: face.sourceImageUrl())!, placeholderImage: UIImage(named: "NoThumbnail"), filter: CropFilter(x: face.positionX(), y: face.positionY(), width: face.width(), height: face.height()) , imageTransition: .crossDissolve(0.5))
      return cell;
    case .relatedVideos:
      //    case 1:
      // related video
      let cell = collectionView.dequeueReusableCell(withReuseIdentifier: "RelatedVideoCell",
        for: indexPath) as! RelatedVideoCell
      
      let related = video!.relatedVideoAt((indexPath as NSIndexPath).row)
      cell.thumbnail.af_setImage(withURL: URL(string: related.thumbnailUrl())!, placeholderImage: UIImage(named: "NoThumbnail"))
      cell.videoTitle.text = related.title()
      
      cell.viewCount.text = String(related.viewCount) + " views"
      cell.starRating.rating = related.starRating
      
      return cell;
    }
  }
  
  override func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
    if (section((indexPath as NSIndexPath).section) == .faces) {
      let face = video!.faceAt((indexPath as NSIndexPath).row)
      videoController?.setCurrentImage(face.sourceImageUrl())
    }
  }
  
}
