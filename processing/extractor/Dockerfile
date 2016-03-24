FROM ubuntu:14.04

ENV DEBIAN_FRONTEND noninteractive

# Initial update and some basics.
# This odd double update seems necessary to get curl to download without 404 errors.
RUN apt-get update --fix-missing && \
apt-get install -y wget && \
apt-get update && \
apt-get install -y curl && \
apt-get update

# Get ffmpeg
RUN apt-get update --fix-missing && \
apt-get install -y software-properties-common && \
add-apt-repository -y ppa:mc3man/trusty-media && \
apt-get update --fix-missing && \
apt-get install -y ffmpeg

# install nodejs and npm
RUN curl -sL https://deb.nodesource.com/setup_0.12 | bash - && \
apt-get install -y nodejs

RUN mkdir /logs

ADD client /blackbox/client
ADD server /blackbox/server

RUN cd /blackbox/server; npm install
RUN cd /blackbox/client; npm install

# Final steps
EXPOSE 8080
CMD ["/bin/bash", "-c", "cd blackbox/server && node ./app.js"]
