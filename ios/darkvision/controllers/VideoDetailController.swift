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
  
  func setVideo(video: Video) {
    self.video = video
    collectionView?.reloadData()
  }
  
  
  enum Sections { case Faces, RelatedVideos }
  
  func section(section: Int) -> Sections {
    if (video == nil || (video != nil && video!.faceCount() > 0)) {
      switch (section) {
      case 0:
        return .Faces
      default:
        return .RelatedVideos
      }
    } else {
      return .RelatedVideos
    }
  }
  
  override func numberOfSectionsInCollectionView(collectionView: UICollectionView) -> Int {
    if (video == nil || (video != nil && video!.faceCount() > 0)) {
      return 2;
    } else {
      return 1;
    }
  }
  
  override func collectionView(collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int {
    switch (self.section(section)) {
    case .Faces:
      return video == nil ? 0 : video!.faceCount()
    case .RelatedVideos:
      return video == nil ? 0 : video!.relatedVideoCount()
    }
  }
  
  func collectionView(collectionView: UICollectionView, layout collectionViewLayout: UICollectionViewLayout, sizeForItemAtIndexPath indexPath: NSIndexPath) -> CGSize {
    return CGSize(width: view.bounds.width - 16, height: 112)
  }
  
  override func collectionView(collectionView: UICollectionView, viewForSupplementaryElementOfKind kind: String, atIndexPath indexPath: NSIndexPath) -> UICollectionReusableView {
    let cell = collectionView.dequeueReusableSupplementaryViewOfKind(kind, withReuseIdentifier: "SectionHeader", forIndexPath: indexPath) as! VideoSectionHeaderCell
    switch (section(indexPath.section)) {
    case .Faces:
      cell.sectionTitle.text = "People in the video"
    case .RelatedVideos:
      cell.sectionTitle.text = "Related videos"
    }
    return cell
  }
  
  override func collectionView(collectionView: UICollectionView, cellForItemAtIndexPath indexPath: NSIndexPath) -> UICollectionViewCell {
    // Configure the cell
    switch (section(indexPath.section)) {
    case .Faces:
      // face
      let cell = collectionView.dequeueReusableCellWithReuseIdentifier("FaceCell",
        forIndexPath: indexPath) as! FaceCell
      
      let face = video!.faceAt(indexPath.row)
      cell.faceName.text = face.name()
      cell.faceAge.text = face.age()
      cell.faceView.af_setImageWithURL(NSURL(string: face.sourceImageUrl())!, placeholderImage: UIImage(named: "NoThumbnail"), filter: CropFilter(x: face.positionX(), y: face.positionY(), width: face.width(), height: face.height()) , imageTransition: .CrossDissolve(0.5))
      return cell;
    case .RelatedVideos:
      //    case 1:
      // related video
      let cell = collectionView.dequeueReusableCellWithReuseIdentifier("RelatedVideoCell",
        forIndexPath: indexPath) as! RelatedVideoCell
      
      let related = video!.relatedVideoAt(indexPath.row)
      cell.thumbnail.af_setImageWithURL(NSURL(string: related.thumbnailUrl())!, placeholderImage: UIImage(named: "NoThumbnail"))
      cell.videoTitle.text = related.title()
      
      cell.viewCount.text = String(related.viewCount) + " views"
      cell.starRating.rating = related.starRating
      
      return cell;
    }
  }
  
  override func collectionView(collectionView: UICollectionView, didSelectItemAtIndexPath indexPath: NSIndexPath) {
    if (section(indexPath.section) == .Faces) {
      let face = video!.faceAt(indexPath.row)
      videoController?.setCurrentImage(face.sourceImageUrl())
    }
  }
  
}
