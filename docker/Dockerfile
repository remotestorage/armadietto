FROM node:lts-alpine

ENV NODE_ENV production

RUN mkdir /opt/armadietto
RUN mkdir -m 0700 /usr/share/armadietto
RUN adduser -u 6582 -HD armadietto
RUN chown armadietto /usr/share/armadietto

WORKDIR /opt/armadietto

COPY package.json ./
COPY package-lock.json ./

RUN npm i --production

COPY README.md ./
COPY bin/ bin/
COPY lib/ lib/
COPY docker/config.json /etc/armadietto.conf.json
RUN ln -s /opt/armadietto/bin/armadietto.js /usr/local/bin/armadietto

VOLUME [ "/usr/share/armadietto" ]
EXPOSE 8000
USER armadietto

CMD [ "armadietto", "-c", "/etc/armadietto.conf.json" ]
