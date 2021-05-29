FROM alpine:latest

LABEL description="Armadietto NodeJS web service (a RemoteStorageJS backend)"

ARG CONFIG_PATH_STORAGE="/usr/share/armadietto"
ARG PROJECT_NAME="armadietto"
ARG PORT="8000"
ARG USER="armadietto"
ARG PKG_MANAGER="yarn"
ARG INSTALL_COMMAND="yarn global --cache-folder /dev/shm/yarn-cache add"

ENV NODE_ENV production
ENV PROJECT_NAME=$PROJECT_NAME

RUN apk add nodejs $PKG_MANAGER
RUN mkdir -m 0700 $CONFIG_PATH_STORAGE
RUN adduser -u 6582 -HD $PROJECT_NAME
RUN chown $PROJECT_NAME $CONFIG_PATH_STORAGE

RUN $INSTALL_COMMAND $PROJECT_NAME

COPY docker/config.json /etc/armadietto.conf.json

VOLUME $CONFIG_PATH_STORAGE
EXPOSE $PORT
USER $PROJECT_NAME

CMD $PROJECT_NAME -c /etc/armadietto.conf.json

HEALTHCHECK CMD curl --fail http://127.0.0.1:$PORT/ || exit 1

### Install ###
#
# BUILD:
#
# default for amd64 architecture
#
# > docker build -t armadietto:latest .
# > docker build -t --build-arg PKG_MANAGER="npm" --build-arg INSTALL_COMMAND="npm i -g" armadietto:latest .
#
# RUN:
#
# > docker run --rm -p 8000:8000 rarmadietto:latest
#
# INFO: config.json needs to be byside the Dockerfile
#
# {
#   "allow_signup": true,
#   "storage_path": "/usr/share/armadietto",
#   "cache_views": true,
#   "http": {
#     "host": "0.0.0.0",
#     "port": 8000
#   },
#   "https": {
#     "enable": false,
#     "force": false,
#     "port": 4443,
#     "cert": "/etc/letsencrypt/live/example.com/cert.pem",
#     "key": "/etc/letsencrypt/live/example.com/privkey.pem"
#   },
#   "basePath": ""
# }
#
###