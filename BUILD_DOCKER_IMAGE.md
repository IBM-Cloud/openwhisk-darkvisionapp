# Deploy Dark Vision manually in IBM Cloud

> :warning: Dark Vision can currently only be deployed in the US South region.

## Get the code

* Clone the app to your local environment from your terminal using the following command:

   ```
   git clone https://github.com/IBM-Cloud/openwhisk-darkvisionapp.git
   ```

* or Download and extract the source code from [this archive](https://github.com/IBM-Cloud/openwhisk-darkvisionapp/archive/master.zip)

## Build the Frame Extractor Docker image

Extracting frames and audio from a video is achieved with ffmpeg. ffmpeg is not available to an Cloud Functions action written in JavaScript or Swift. Fortunately Cloud Functions allows to write an action as a Docker image and can retrieve this image from Docker Hub.

To build the extractor image, follow these steps:

1. Change to the ***processing/extractor*** directory.

1. Ensure your Docker environment works and that you have logged in Docker hub. To login use `docker login`.

1. Run

  ```
  ./buildAndPush.sh youruserid/yourimagename
  ```
  > Note: On some systems this command needs to be run with `sudo`.

1. After a while, your image will be available in Docker Hub, ready for Cloud Functions.

1. Change the `DOCKER_EXTRACTOR_NAME` environment variable property in the **Deploy** stage of the toolchain and run the stage to use the new image.
