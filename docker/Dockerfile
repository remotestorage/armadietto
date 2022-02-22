FROM alpine:latest as build

ARG PKG_MANAGER="npm"
ARG INSTALL_COMMAND="npm install --production"

RUN mkdir /opt/armadietto
WORKDIR /opt/armadietto

RUN apk add nodejs $PKG_MANAGER

COPY package.json ./
COPY package-lock.json ./

RUN $INSTALL_COMMAND

FROM alpine:latest

LABEL description="Armadietto Node.js web service (a remoteStorage server)"

ARG CONFIG_PATH_STORAGE="/usr/share/armadietto"
ARG CONFIG_PATH_LOGS="/opt/armadietto/logs"
ARG PROJECT_NAME="armadietto"
ARG PORT="8000"
ARG USER="armadietto"

ENV NODE_ENV=production
ENV PROJECT_NAME=$PROJECT_NAME
ENV PORT=$PORT

RUN mkdir /opt/armadietto
WORKDIR /opt/armadietto


RUN apk add nodejs

RUN adduser -u 6582 -HD $PROJECT_NAME

RUN mkdir -m 0700 $CONFIG_PATH_STORAGE
RUN mkdir -m 0700 $CONFIG_PATH_LOGS
RUN chown $PROJECT_NAME $CONFIG_PATH_STORAGE
RUN chown $PROJECT_NAME $CONFIG_PATH_LOGS

COPY --from=build /opt/armadietto/node_modules/ node_modules/
COPY package.json ./
COPY README.md ./
COPY lib/ lib/
COPY bin/ bin/

RUN ln -s /opt/armadietto/bin/armadietto.js /usr/local/bin/armadietto

COPY docker/config.json /etc/armadietto.conf.json

VOLUME $CONFIG_PATH_STORAGE
VOLUME $CONFIG_PATH_LOGS
EXPOSE $PORT
USER $PROJECT_NAME

CMD /opt/armadietto/bin/armadietto.js -c /etc/armadietto.conf.json

HEALTHCHECK --start-period=10s CMD wget -q -O /dev/null http://127.0.0.1:$PORT/
