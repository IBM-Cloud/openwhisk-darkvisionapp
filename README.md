# Dark Vision - Discover dark data in videos with IBM Watson and IBM Bluemix OpenWhisk

Dark Vision processes videos to discover dark data. By analyzing video frames with
IBM Watson Visual Recognition, Dark Vision builds a summary
with a set of tags and famous people or building detected in the video. Use this
summary to enhance video search and categorization.

  <img src="xdocs/dv-video-summary.png" width="200"/>
  <img src="xdocs/dv-ios-browse.png" width="200"/>
  <img src="xdocs/dv-ios-video-details.png" width="200"/>

In addition to processing videos, Dark Vision can also processes standalone images.

### Watch this Youtube video to know more about the app

[![Dark Vision](xdocs/dv-video-play.png)](https://www.youtube.com/watch?v=1teIMpkI_Sg&feature=youtu.be "Dark Vision")

## Overview

 Built using IBM Bluemix, the application uses:
  * Watson Visual Recognition
  * OpenWhisk
  * Cloudant
  * Object Storage (optional component)

### Extracting frames from a video

The user uploads a video or image using the Dark Vision web application, which stores it in a Cloudant DB. Once the video is uploaded, OpenWhisk detects the new video by listening to Cloudant changes (trigger).
OpenWhisk then triggers the video extractor action. During its execution, the extractor produces frames (images)
and stores them in Cloudant. The frames are then processed using Watson Visual Recognition and the results are stored in the same Cloudant DB. The results can be viewed using Dark Vision web application OR an iOS application.

Object Storage can be used in addition to Cloudant. When doing so, video and image medadata are stored in Cloudant and the media files are stored in Object Storage.

![Architecture](http://g.gravizo.com/g?
  digraph G {
    node [fontname = "helvetica"]
    rankdir=LR
    /* stores a video */
    user -> storage
    /* cloudant change sent to openwhisk */
    storage -> openwhisk
    /* openwhisk triggers the extractor */
    openwhisk -> extractor
    /* extractor produces image frames */
    extractor -> frames
    /* frames are stored in cloudant */
    frames -> storage
    /* styling */
    frames [label="Image Frames"]
    storage [shape=circle style=filled color="%234E96DB" fontcolor=white label="Data Store"]
    openwhisk [shape=circle style=filled color="%2324B643" fontcolor=white label="OpenWhisk"]
  }
)

### Processing frames and standalone images

Whenever a frame is created and uploaded, Cloudant emits a change event and
OpenWhisk triggers the analysis. The analysis is persisted with the image.

![Architecture](http://g.gravizo.com/g?
  digraph G {
    node [fontname = "helvetica"]
    /* stores a image */
    frame -> storage
    /* cloudant change sent to openwhisk */
    storage -> openwhisk
    /* openwhisk triggers the analysis */
    openwhisk -> analysis
    /* extractor produces image frames */
    {rank=same; frame -> storage -> openwhisk -> analysis -> watson [style=invis] }
    /* analysis calls Watson */
    analysis -> watson
    /* results are stored */
    analysis -> storage
    /* styling */
    frame [label="Image Frame"]
    analysis [label="Image Analysis"]
    storage [shape=circle style=filled color="%234E96DB" fontcolor=white label="Data Store"]
    openwhisk [shape=circle style=filled color="%2324B643" fontcolor=white label="OpenWhisk"]
    watson [shape=circle style=filled color="%234E96DB" fontcolor=white label="Watson\\nVisual\\nRecognition"]
  }
)

## Application Requirements

* IBM Bluemix account. [Sign up][bluemix_signup_url] for Bluemix, or use an existing account.
* Docker Hub account. [Sign up](https://hub.docker.com/) for Docker Hub, or use an existing account.
* XCode 8.0, iOS 10, Swift 3

## Preparing the environment

### Get the code

* Clone the app to your local environment from your terminal using the following command:

  ```
  git clone https://github.com/IBM-Bluemix/openwhisk-darkvisionapp.git
  ```

* or Download and extract the source code from [this archive](https://github.com/IBM-Bluemix/openwhisk-darkvisionapp/archive/master.zip)

### Create the Bluemix Services

***Note***: *if you have existing instances of these services, you don't need to create new instances.
You can simply reuse the existing ones.*

1. Open the IBM Bluemix console

1. Create a Cloudant NoSQL DB service instance named **cloudant-for-darkvision**

1. Open the Cloudant service dashboard and create a new database named **openwhisk-darkvision**

1. Create a Watson Visual Recognition service instance named **visualrecognition-for-darkvision**

1. Optionally create a Object Storage service instance named **objectstorage-for-darkvision**

  > If configured, media files will be stored in Object Storage instead of Cloudant. A container named *openwhisk-darkvision* will be automatically created.

### Deploy the web interface to upload videos and images

This simple web user interface is used to upload the videos or images and
visualize the results of each frame analysis.

1. Change to the **web** directory.

  ```
  cd openwhisk-darkvisionapp/web
  ```

1. If in the previous section you decided to use existing services instead of creating new ones, open **manifest.yml** and update the Cloudant service name.

1. If you configured an Object Storage service, make sure to add its name to the list of services in the **manifest.yml** *services* section or to uncomment the existing **objectstorage-for-darkvision** entry.

1. Push the application to Bluemix:

  ```
  cf push
  ```

#### Protecting the upload, delete and reset actions (optional)

By default, anyone can upload/delete/reset videos and images. You can restrict access to these actions by defining the environment variables *ADMIN_USERNAME* and *ADMIN_PASSWORD* on your application. This can be done in the Bluemix console or with the command line:

  ```
  cf set-env openwhisk-darkvision ADMIN_USERNAME admin
  cf set-env openwhisk-darkvision ADMIN_PASSWORD aNotTooSimplePassword
  ```

### Build the Frame Extractor Docker image

Extracting frames from a video is achieved with ffmpeg. ffmpeg is not available to an OpenWhisk
action written in JavaScript or Swift. Fortunately OpenWhisk allows to write an action as a Docker
image and can retrieve this image from Docker Hub.

To build the extractor image, follow these steps:

1. Change to the ***processing/extractor*** directory.

1. Ensure your Docker environment works and that you have logged in Docker hub.

1. Run

  ```
  ./buildAndPush.sh youruserid/yourimagename
  ```
  Note: On some systems this command needs to be run with `sudo`.

1. After a while, your image will be available in Docker Hub, ready for OpenWhisk.

### Deploy OpenWhisk Actions

1. Change to the **processing** directory.

1. Copy the file named **template-local.env** into **local.env**

  ```
  cp template-local.env local.env
  ```

1. Get the service credentials for services created above and replace placeholders in `local.env`
with corresponding values (usernames, passwords, urls). These properties will be injected into
a package so that all actions can get access to the services.

  > If you configured an Object Storage service, specify its properties in this file too but uncommenting the placeholder variables.

1. Make sure to also update the value of ***DOCKER_EXTRACTOR_NAME*** with the name of the Docker
image you created in the previous section.

1. Ensure your [OpenWhisk command line interface](https://new-console.ng.bluemix.net/openwhisk/cli) is property configured with:

  ```
  wsk list
  ```

  This shows the packages, actions, triggers and rules currently deployed in your OpenWhisk namespace.

1. Create the action, trigger and rule using the script from the **processing** directory:

  ```
  ./deploy-darkvision.sh --install
  ```

  Note: the script can also be used to *--uninstall* the OpenWhisk artifacts to
  *--update* the artifacts if you change the action code, or simply with *--env*
  to show the environment variables set in **local.env**.

**That's it! Use the web application to upload images/videos and view the results! You can also view the results using an iOS application as shown further down this README.**


## Running the web application locally

1. Change to the **web** directory

1. Get dependencies

  ```
  npm install
  ```

1. Start the application

  ```
  npm start
  ```

  Note: To find the Cloudant database (and Object Storage) to connect to when running locally,
  the application uses the environment variables defined in **processing/local.env** in previous steps.

1. Upload videos through the web user interface. Wait for OpenWhisk to process the videos.
Look at the results. While OpenWhisk processes videos, the counters at the top of the
application will update. These counters call the **/api/status** endpoint of the web
application to retrieve statistics.

### iOS application to view the results (Optional)

The iOS application is a client to the API exposed by the web application
to view the results of the analysis of videos. It is an optional piece.

To configure the iOS application, you need the URL of the web application deployed before.
The web app exposes an API to list all videos and retrieve the results.

1. Open **ios/darkvision.xcworkspace** with XCode

1. Open the file **darkvision/darkvision/model/API.swift**

1. Set the value of the constant **apiUrl** to the application host previously deployed.

1. Save the file

## Running the iOS application in the simulator

1. Start the application from XCode with *iPad Air 2* as the target

  <img src="xdocs/dv-set-target.png" width="300"/>

1. Browse uploaded videos

  <img src="xdocs/dv-simulator-browse.png" width="200">

1. Select a video

  <img src="xdocs/dv-simulator-one-video.png" width="200">

  Results are made of the faces detected in the picture
  and of tags returned by Watson.
  The tags with the highest confidence score are shown.
  Tap a tag or a face to change the main image to the
  frame where this tag or face was detected.  

## Code Structure

### OpenWhisk - Deployment script

| File | Description |
| ---- | ----------- |
|[**deploy-darkvision.sh**](processing/deploy-darkvision.sh)|Helper script to install, uninstall, update the OpenWhisk trigger, actions, rules used by Dark Vision.|

### OpenWhisk - Change listener

| File | Description |
| ---- | ----------- |
|[**changelistener.js**](processing/changelistener/changelistener.js)|Processes Cloudant change events and calls the right actions. It controls the processing flow for videos and frames.|

### OpenWhisk - Frame extraction

The **frame extractor** runs as a Docker action created with the [OpenWhisk Docker SDK](https://console.ng.bluemix.net/docs/openwhisk/openwhisk_reference.html#openwhisk_ref_docker):
  * It uses *ffmpeg* to extract frames from the video.
  * It is written as a nodejs app to benefit from several nodejs helper packages (Cloudant, ffmpeg, imagemagick)

| File | Description |
| ---- | ----------- |
|[**Dockerfile**](processing/extractor/Dockerfile)|Docker file to build the extractor image. It pulls ffmpeg into the image together with node. It also runs npm install for both the server and client.|
|[**extract.js**](processing/extractor/client/extract.js)|The core of the frame extractor. It downloads the video stored in Cloudant, uses ffmpeg to extract frames and video metadata, produces a thumbnail for the video. By default it produces around 15 images for a video. This can be changed by modifying the implementation of **getFps**.|
|[**app.js**](processing/extractor/server/app.js)|Adapted from the OpenWhisk Docker SDK to call the extract.js node script.|

### OpenWhisk - Frame analysis

[**analysis.js**](processing/analysis/analysis.js) holds the JavaScript code to perform the image analysis:

1. It retrieves the image data from the Cloudant document.
The data has been attached by the *frame extractor* as an attachment named "image.jpg".
1. It saves the image file locally.
1. If needed, it resizes the image so that it matches the requirements of the Watson service
1. It calls Watson
1. It attachs the results of the analysis to the image and persist it.

The action runs asynchronously.

The code is very similar to the one used in the [Vision app](https://github.com/IBM-Bluemix/openwhisk-visionapp). Main difference

### Web app

The web application allows to upload videos (and images).
It shows the video catalog and for each video the extracted frames.

| File | Description |
| ---- | ----------- |
|[**app.js**](web/app.js)|The web app backend handles the upload of videos/images, and exposes an API to retrieve all videos, their frames, to compute the summary|
|[**Angular controllers**](web/public/js)|Controllers for list of videos, individual video and standalone images|
|[**Angular services**](web/public/js)|Services to interact with the backend API|

### Shared code between OpenWhisk actions and web app

These files are used by the web application and the OpenWhisk actions. They are automatically injected in the OpenWhisk actions by the [**deploy-darkvision.sh**](processing/deploy-darkvision.sh) script and during the [**build**](processing/extractor/buildAndPush.sh) of the Docker image. These scripts have dependencies on *Cloudant, async, pkgcloud* which are provided by default in OpenWhisk Node.js actions.

| File | Description |
| ---- | ----------- |
|[**cloudantstorage.js**](web/lib/cloudantstorage.js)|Implements API on top of Cloudant to create/read/update/delete video/image metadata and to upload files|
|[**objectstorage.js**](web/lib/objectstorage.js)|Implements the file upload operations on top of Object Storage. Used by [**cloudantstorage.js**](web/lib/cloudantstorage.js) when Object Storage is configured.|
|[**cloudant-designs.json**](web/lib/cloudant-designs.json)|Design documents used by the API to expose videos and images. They are automatically loaded into the database when the web app starts for the first time.|

### iOS

The iOS app is an optional part of the Dark Vision sample app.
It uses the API exposed by the web application to display
the videos in the catalog and their associated tags.

| File | Description |
| ---- | ----------- |
|[**API.swift**](ios/darkvision/model/API.swift)|Calls the web app API. Update the constant **apiUrl** to map to the location of your web app.|

## Contribute

Please create a pull request with your desired changes.

## Troubleshooting

### OpenWhisk

Polling activations is good start to debug the OpenWhisk action execution. Run
```
wsk activation poll
```
and upload a video for analysis.

### Web application

Use
```
cf logs <appname>
```
to look at the live logs for the web application

[bluemix_signup_url]: https://console.ng.bluemix.net/?cm_mmc=GitHubReadMe

## License

See [License.txt](License.txt) for license information.

## Privacy Notice

The web application includes code to track deployments to [IBM Bluemix](https://www.bluemix.net/) and other Cloud Foundry platforms. The following information is sent to a [Deployment Tracker](https://github.com/cloudant-labs/deployment-tracker) service on each deployment:

* Application Name (`application_name`)
* Space ID (`space_id`)
* Application Version (`application_version`)
* Application URIs (`application_uris`)

This data is collected from the `VCAP_APPLICATION` environment variable in IBM Bluemix and other Cloud Foundry platforms. This data is used by IBM to track metrics around deployments of sample applications to IBM Bluemix to measure the usefulness of our examples, so that we can continuously improve the content we offer to you. Only deployments of sample applications that include code to ping the Deployment Tracker service will be tracked.

### Disabling Deployment Tracking

Deployment tracking can be disabled by removing require("cf-deployment-tracker-client").track(); from the beginning of the web/app.js file.
