/* eslint-env mocha, chai, node */
/* eslint-disable no-unused-expressions */

const chai = require('chai');
const path = require('path');
const expect = chai.expect;
chai.use(require('chai-as-promised'));
const { Readable } = require('node:stream');
const { open } = require('node:fs/promises');
const ParameterError = require('../lib/util/ParameterError');

module.exports.shouldStream = function () {
  describe('createUser', function () {
    before(function () {
      this.username1 = 'automated-test-' + Math.round(Math.random() * Number.MAX_SAFE_INTEGER);
    });

    after(async function () {
      await this.store.deleteUser(this.username1);
    });

    it('rejects a user with too short a name', async function () {
      const params = { username: 'a', email: 'a@b.c', password: 'swordfish' };
      await expect(this.store.createUser(params)).to.be.rejectedWith(Error, 'Username must be at least 2 characters');
    });

    it('rejects creating a user with illegal characters in username', async function () {
      const params = { username: 'a+a', email: 'a@b.c', password: 'swordfish' };
      await expect(this.store.createUser(params)).to.be.rejectedWith(Error, 'only contain lowercase letters, numbers, dots, dashes and underscores');
    });

    it('rejects creating a user with bad email', async function () {
      const params = { username: 'a1a', email: 'a@b', password: 'swordfish' };
      await expect(this.store.createUser(params)).to.be.rejectedWith(Error, 'Email is not valid');
    });

    it('rejects creating a user without password', async function () {
      const params = { username: 'a2a', email: 'a@b.c', password: '' };
      await expect(this.store.createUser(params)).to.be.rejectedWith(Error, 'Password must not be blank');
    });

    it('creates a user & rejects creating a new user with an existing name', async function () {
      const params1 = { username: this.username1, email: 'a@b.c', password: 'swordfish' };
      await expect(this.store.createUser(params1)).to.eventually.eql(this.username1);
      const params2 = { username: this.username1, email: 'd@e.f', password: 'iloveyou' };
      await expect(this.store.createUser(params2)).to.be.rejectedWith(Error, 'is already taken');
    });
  });

  describe('deleteUser', function () {
    before(function () {
      this.username2 = 'automated-test-' + Math.round(Math.random() * Number.MAX_SAFE_INTEGER);
    });

    after(async function () {
      await this.store.deleteUser(this.username2);
    });

    it('deletes a user', async function () {
      const params = { username: this.username2, email: 'a@b.c', password: 'swordfish' };
      await expect(this.store.createUser(params)).to.eventually.eql(this.username2);
      await expect(this.store.deleteUser(this.username2)).to.eventually.be.greaterThanOrEqual(2);
    });
  });

  describe('authenticate', function () {
    let goodParams;

    before(async function () {
      goodParams = {
        username: 'automated-test-' + Math.round(Math.random() * Number.MAX_SAFE_INTEGER),
        email: 'g@h.i',
        password: 'dictionary'
      };
      return this.store.createUser(goodParams);
    });

    after(async function () {
      return this.store.deleteUser(goodParams.username);
    });

    it('throws a cagey error if the user does not exist', async function () {
      const badParams = { username: 'nonexisting', email: 'g@h.i', password: 'dictionary' };
      await expect(this.store.authenticate(badParams)).to.be.rejectedWith('Password and username do not match');
    });

    it('throws a cagey error for a wrong password for an existing user', async function () {
      const badPassword = Object.assign({}, goodParams, { password: 'wrong' });
      await expect(this.store.authenticate(badPassword)).to.be.rejectedWith('Password and username do not match');
    });

    it('resolves for a good user', async function () {
      await expect(this.store.authenticate(goodParams)).to.eventually.equal(true);
    });
  });

  // authorization: save permissions to session.permissions
  // permissions: read session.permissions
  // revokeAccess: delete session.permissions

  describe('storage methods', function () {
    before(async function () {
      try {
        await this.store.deleteUser('boris');
        await this.store.createUser({ username: 'boris', email: 'j@k.l', password: '1234' });
      } catch (err) {
        console.error('while pre-deleting & re-creating “boris”: ', err);
      }
    });

    after(async function () {
      await this.store.deleteUser('boris');
    });

    describe('put', function () {
      it('does not create a file for a bad user name', async function () {
        const content = 'microbe';
        const contentStream = Readable.from([content], { objectMode: false });
        expect(this.store.put('@%$#%#$@%$#', '/not-created/non-existent/user', 'image/tiff', content.length, contentStream, null)).to.be.rejectedWith(ParameterError, 'A parameter value is bad');
      });

      // TODO: should there be a clearer message?
      // A nonexistent user here means storage has been deleted but the account still exists.
      it('does not create a file for a nonexistant user', async function () {
        const content = 'microbe';
        const contentStream = Readable.from([content], { objectMode: false });
        expect(this.store.put('non-existent-user', '/not-created/non-existent/user', 'image/tiff', content.length, contentStream, null)).to.be.rejectedWith(ParameterError, 'A parameter value is bad');
      });

      it('does not create a file for an empty path', async function () {
        const content = 'microbe';
        const contentStream = Readable.from([content], { objectMode: false });
        expect(this.store.put('boris', '', 'image/tiff', content.length, contentStream, null)).to.be.rejectedWith(ParameterError, 'A parameter value is bad');
      });

      it('does not create a file for a path with a bad character', async function () {
        const content = 'microbe';
        const contentStream = Readable.from([content], { objectMode: false });
        expect(this.store.put('boris', 'foo\0bar', 'image/tiff', content.length, contentStream, null)).to.be.rejectedWith(ParameterError, 'A parameter value is bad');
      });

      it('does not create a file for a path with a bad element', async function () {
        const content = 'microbe';
        const contentStream = Readable.from([content], { objectMode: false });
        expect(this.store.put('boris', 'foo/../bar', 'image/tiff', content.length, contentStream, null)).to.be.rejectedWith(ParameterError, 'A parameter value is bad');
      });

      it('sets the value of an item', async function () {
        const content = 'vertibo';
        const [result, ETag] = await this.store.put('boris', '/photos/zipwire', 'image/poster', content.length, Readable.from([content], { objectMode: false }), null);
        expect(result).to.equal('CREATED');
        expect(ETag).to.match(/^".{6,128}"$/);

        const { status, readStream, contentType, contentLength, ETag: retrievedETag } = await this.store.get('boris', '/photos/zipwire', null);
        expect(status).to.equal(200);
        const retrievedContent = (await readStream.setEncoding('utf-8').toArray())[0];
        expect(retrievedContent).to.be.deep.equal('vertibo');
        expect(contentType).to.equal('image/poster');
        expect(contentLength).to.equal(content.length);
        expect(retrievedETag).to.match(/^".{6,128}"$/);
        expect(retrievedETag).to.equal(ETag);
      });

      it('sets the value of an item, without length', async function () {
        const content = 'vertibo';
        const [result, ETag] = await this.store.put('boris', '/photos/summer', 'image/poster', undefined, Readable.from([content], { objectMode: false }), null);
        expect(result).to.equal('CREATED');
        expect(ETag).to.match(/^".{6,128}"$/);

        const { status, readStream, contentType, contentLength, ETag: retrievedETag } = await this.store.get('boris', '/photos/summer', null);
        expect(status).to.equal(200);
        const retrievedContent = (await readStream.setEncoding('utf-8').toArray())[0];
        expect(retrievedContent).to.be.deep.equal('vertibo');
        expect(contentType).to.equal('image/poster');
        expect(contentLength).to.equal(content.length);
        expect(retrievedETag).to.match(/^".{6,128}"$/);
        expect(retrievedETag).to.equal(ETag);
      });

      it('stores binary data', async function () {
        const fileHandle = await open(path.join(__dirname, 'whut2.jpg'));
        const stat = await fileHandle.stat();
        const fileStream = fileHandle.createReadStream();
        const [result, ETag] = await this.store.put('boris', '/photos/election', 'image/jpeg', stat.size, fileStream, null);
        expect(result).to.equal('CREATED');
        expect(ETag).to.match(/^".{6,128}"$/);
        await fileHandle.close();

        const { status, readStream, contentType, contentLength, ETag: retrievedETag } = await this.store.get('boris', '/photos/election', null);
        expect(status).to.equal(200);
        const totalSize = (await readStream.toArray()).reduce((acc, curr) => acc + curr.length, 0);
        expect(totalSize).to.equal(stat.size);
        expect(contentType).to.equal('image/jpeg');
        expect(contentLength).to.equal(stat.size);
        expect(retrievedETag).to.equal(ETag);
      });

      it('sets the value of a public item', async function () {
        const content = 'vertibo';
        const [result, putETag] = await this.store.put('boris', '/public/photos/zipwire2', 'image/poster', content.length, Readable.from([content], { objectMode: false }), null);
        expect(result).to.equal('CREATED');
        expect(putETag).to.match(/^".{6,128}"$/);

        const { status, readStream, contentType, contentLength, ETag: retrievedETag } = await this.store.get('boris', '/public/photos/zipwire2', null);
        expect(status).to.equal(200);
        const retrievedContent = (await readStream.setEncoding('utf-8').toArray())[0];
        expect(retrievedContent).to.be.deep.equal('vertibo');
        expect(contentType).to.equal('image/poster');
        expect(contentLength).to.equal(content.length);
        expect(retrievedETag).to.equal(putETag);

        const response = await this.store.get('boris', '/photos/zipwire2', null);
        expect(response.status).to.equal(404);
        expect(response.ETag).to.equal(null);
      });

      it('sets the value of a root item', async function () {
        const content = 'gizmos';
        const [result, putETag] = await this.store.put('boris', '/manifesto', 'text/plain', content.length, Readable.from([content], { objectMode: false }), null);
        expect(result).to.equal('CREATED');
        expect(putETag).to.match(/^".{6,128}"$/);

        const { status, readStream, contentType, contentLength, ETag: retrievedETag } = await this.store.get('boris', '/manifesto', null);
        expect(status).to.equal(200);
        const retrievedContent = (await readStream.setEncoding('utf-8').toArray())[0];
        expect(retrievedContent).to.be.deep.equal(content);
        expect(contentType).to.equal('text/plain');
        expect(contentLength).to.equal(content.length);
        expect(retrievedETag).to.equal(putETag);
      });

      it('sets the value of a deep item', async function () {
        const content = 'more gizmos';
        const [result, putETag] = await this.store.put('boris', '/deep/dir/secret', 'text/plain', content.length, Readable.from([content], { objectMode: false }), null);
        expect(result).to.equal('CREATED');
        expect(putETag).to.match(/^".{6,128}"$/);

        const { status, readStream, contentType, contentLength, ETag: retrievedETag } = await this.store.get('boris', '/deep/dir/secret', null);
        expect(status).to.equal(200);
        const retrievedContent = (await readStream.setEncoding('utf-8').toArray())[0];
        expect(retrievedContent).to.be.deep.equal(content);
        expect(contentType).to.equal('text/plain');
        expect(contentLength).to.equal(content.length);
        expect(retrievedETag).to.equal(putETag);
      });

      it.skip('transfers very large files', async function () {
        this.timeout(20 * 60_000);

        const LIMIT = 600_000_000;
        // const LIMIT = 5_000_000_000_000;   // 5 TiB
        async function * bigContent () {
          let total = 0;
          while (total < LIMIT) {
            total += 100;
            const numberStr = String(total);
            let line = '....................................................................................................';
            line = line.slice(0, -numberStr.length) + numberStr;
            const buffer = Buffer.from(line, 'utf8');
            if (total % 1_000 === 0) {
              console.log(line);
            }
            yield buffer;
          }
        }
        const asyncIterator = bigContent();

        const [result, putETag] = await this.store.put('boris', '/archive/bigfile', 'text/plain', LIMIT, Readable.from(asyncIterator), null);
        expect(result).to.equal('CREATED');
        expect(putETag).to.match(/^".{6,128}"$/);

        // await new Promise(resolve => setTimeout(resolve, 10*60_000))
      });

      describe('for a nested document', function () {
        it('creates the parent directory', async function () {
          const content = 'mindless content';
          const [result, putETag] = await this.store.put('boris', '/photos/foo/bar/qux', 'text/example', content.length, Readable.from([content], { objectMode: false }), null);
          expect(result).to.equal('CREATED');
          expect(putETag).to.match(/^".{6,128}"$/);

          const { status, readStream, contentType, contentLength, ETag: directoryETag } = await this.store.get('boris', '/photos/foo/bar/', null);
          expect(status).to.equal(200);
          expect(contentType).to.equal('application/ld+json');
          expect(contentLength).to.be.greaterThan(0);
          expect(directoryETag).to.match(/^".{6,128}"$/);

          const directory = JSON.parse((await readStream.setEncoding('utf-8').toArray())[0]);
          expect(directory.items.qux['Content-Length']).to.be.equal(content.length);
          expect(directory.items.qux['Content-Type']).to.be.equal('text/example');
          expect(directory.items.qux.ETag).to.be.equal(putETag);
          expect(Date.now() - new Date(directory.items.qux['Last-Modified'])).to.be.lessThan(5000);

          const { status: status2, contentType: contentType2, ETag: directoryETag2 } = await this.store.get('boris', '/photos/foo/bar/', null);
          expect(status2).to.equal(200);
          expect(contentType2).to.equal('application/ld+json');
          expect(directoryETag2).to.match(/^".{6,128}"$/);
        });

        it('does not create path named as already existing document', async function () {
          const content = 'Londonderry';
          const [firstResult, firstETag] = await this.store.put('boris', '/photos/collection', 'application/zip', content.length,
            Readable.from([content], { objectMode: false }), null);
          expect(firstResult).to.equal('CREATED');
          expect(firstETag).to.match(/^".{6,128}"$/);

          const [secondResult, secondETag] = await this.store.put('boris', '/photos/collection/dramatic/winter', 'image/jxl', content.length,
            Readable.from([content], { objectMode: false }), null);
          expect(secondResult).to.equal('CONFLICT');
          expect(Boolean(secondETag)).to.be.false;

          const { status, readStream, ETag: retrievedETag } = await this.store.get('boris', '/photos/collection/dramatic', null);
          expect(status).to.equal(404);
          expect(Boolean(readStream)).to.be.false;
          expect(Boolean(retrievedETag)).to.be.false;
        });

        it('does not create a document where a folder exists', async function () {
          const content = 'Dublin';
          const [firstResult, firstETag] = await this.store.put('boris',
            '/photos/album/movie-posters/Make Way for Tomorrow', 'image/jp2', content.length,
            Readable.from([content], { objectMode: false }), null);
          expect(firstResult).to.equal('CREATED');
          expect(firstETag).to.match(/^".{6,128}"$/);

          const [secondResult, secondETag] = await this.store.put('boris', '/photos/album', 'application/archive',
            content.length, Readable.from([content], { objectMode: false }), null);
          expect(secondResult).to.equal('CONFLICT');
          expect(Boolean(secondETag)).to.be.false;

          const { status, readStream, ETag: retrievedETag } = await this.store.get('boris', '/photos/album', null);
          expect(status).to.equal(409);
          expect(Boolean(readStream)).to.be.false;
          expect(Boolean(retrievedETag)).to.be.false;
        });
      });

      it('does not create a file when If-Match has an ETag', async function () {
        const content = 'Leinster';
        const contentStream = Readable.from([content], { objectMode: false });
        const [result, ETag] = await this.store.put('boris', '/if-match/tag-create', 'image/jp2', content.length, contentStream, { name: 'If-Match', ETag: '"ETag|Leinster"' });
        expect(result).to.equal('PRECONDITION FAILED');
        expect(Boolean(ETag)).to.equal(false);
      });

      it('updates a file when If-Match has a matching ETag', async function () {
        const content = 'Dublin';
        const [firstResult, firstETag] = await this.store.put('boris', '/if-match/equal', 'text/plain', content.length,
          Readable.from([content], { objectMode: false }),
          null);
        expect(firstResult).to.equal('CREATED');
        expect(firstETag).to.match(/^".{6,128}"$/);

        const newContent = 'Wexford';
        const [secondResult, secondETag] = await this.store.put('boris', '/if-match/equal', 'text/plain', newContent.length,
          Readable.from([newContent], { objectMode: false }),
          { name: 'If-Match', ETag: firstETag });
        expect(secondResult).to.equal('UPDATED');
        expect(secondETag).to.match(/^".{6,128}"$/);

        const { status, readStream, contentType, contentLength, ETag: retrievedETag } = await this.store.get('boris', '/if-match/equal', null);
        expect(status).to.equal(200);
        const retrievedContent = (await readStream.setEncoding('utf-8').toArray())[0];
        expect(retrievedContent).to.be.deep.equal(newContent);
        expect(contentType).to.equal('text/plain');
        expect(contentLength).to.equal(newContent.length);
        expect(retrievedETag).to.equal(secondETag);
      });

      it('does not update a file when If-Match has an old ETag', async function () {
        const originalContent = 'Bad Wurtemburg';
        const [firstResult, firstETag] = await this.store.put('boris', '/if-match/not-equal', 'text/plain', originalContent.length,
          Readable.from([originalContent], { objectMode: false }),
          null);
        expect(firstResult).to.equal('CREATED');
        expect(firstETag).to.match(/^".{6,128}"$/);

        const newContent = 'Berlin';
        const [secondResult, secondETag] = await this.store.put('boris', '/if-match/not-equal', 'text/plain', newContent.length,
          Readable.from([newContent], { objectMode: false }),
          { name: 'If-Match', ETag: '"987654321"' });
        expect(secondResult).to.equal('PRECONDITION FAILED');
        expect(secondETag).to.match(/^".{6,128}"$/);

        const { status, readStream } = await this.store.get('boris', '/if-match/not-equal', null);
        expect(status).to.equal(200);
        const retrievedContent = (await readStream.setEncoding('utf-8').toArray())[0];
        expect(retrievedContent).to.be.deep.equal(originalContent);
      });

      it('creates a file when If-None-Match is *', async function () {
        const content = 'crocodile';
        const contentStream = Readable.from([content], { objectMode: false });
        const [result, ETag] = await this.store.put('boris', '/if-none-match/new-star', 'image/jp2', content.length, contentStream, { name: 'If-None-Match', ETag: '*' });
        expect(result).to.equal('CREATED');
        expect(ETag).to.match(/^".{6,128}"$/);
      });

      it('does not change a file when If-None-Match is *', async function () {
        const originalContent = 'mouse';
        const [firstResult, firstETag] = await this.store.put('boris', '/if-none-match/update-star', 'text/plain',
          originalContent.length, Readable.from([originalContent], { objectMode: false }), null);
        expect(firstResult).to.equal('CREATED');
        expect(firstETag).to.match(/^".{6,128}"$/);

        const newContent = 'elephant';
        const contentStream = Readable.from([newContent], { objectMode: false });
        const [result, ETag] = await this.store.put('boris', '/if-none-match/update-star', 'image/gif', newContent.length, contentStream, { name: 'If-None-Match', ETag: '*' });
        expect(result).to.equal('PRECONDITION FAILED');
        expect(Boolean(ETag)).to.equal(false);
      });

      it('creates when If-None-Match is ETag', async function () {
        const content = 'gila monster';
        const contentStream = Readable.from([content], { objectMode: false });
        const [result, ETag] = await this.store.put('boris', '/if-none-match/tag-create', 'message/example', content.length, contentStream, { name: 'If-None-Match', ETag: '"aaa111bbb222ccc333"' });
        expect(result).to.equal('CREATED');
        expect(ETag).to.match(/^".{6,128}"$/);
      });

      it('overwrites a file when If-None-Match has a different ETag', async function () {
        const content = 'Memphis';
        const [firstResult, firstETag] = await this.store.put('boris', '/if-none-match/not-equal', 'text/example', content.length,
          Readable.from([content], { objectMode: false }),
          null);
        expect(firstResult).to.equal('CREATED');
        expect(firstETag).to.match(/^".{6,128}"$/);

        const newContent = 'Cairo';
        const [secondResult, secondETag] = await this.store.put('boris', '/if-none-match/not-equal', 'text/plain', newContent.length,
          Readable.from([newContent], { objectMode: false }),
          { name: 'If-None-Match', ETag: '"zzz999yyy888xxx777"' });
        expect(secondResult).to.equal('UPDATED');
        expect(secondETag).to.match(/^".{6,128}"$/);

        const { status, readStream, contentType, contentLength, ETag: retrievedETag } = await this.store.get('boris', '/if-none-match/not-equal', null);
        expect(status).to.equal(200);
        const retrievedContent = (await readStream.setEncoding('utf-8').toArray())[0];
        expect(retrievedContent).to.be.deep.equal(newContent);
        expect(contentType).to.equal('text/plain');
        expect(contentLength).to.equal(newContent.length);
        expect(retrievedETag).to.equal(secondETag);
      });

      it('avoids unnecessary transfer when If-None-Match is equal', async function () {
        const content = 'const ANSWER = 42;';
        const [firstResult, ETag] = await this.store.put('boris', '/if-none-match/update-equal', 'text/x-java',
          content.length, Readable.from([content], { objectMode: false }), null);
        expect(firstResult).to.equal('CREATED');
        expect(ETag).to.match(/^".{6,128}"$/);

        const contentStream = Readable.from([content], { objectMode: false });
        const [result, secondETag] = await this.store.put('boris', '/if-none-match/update-equal', 'text/x-java',
          content.length, contentStream, { name: 'If-None-Match', ETag });
        expect(result).to.equal('PRECONDITION FAILED');
        expect(Boolean(secondETag)).to.equal(false);
        expect(contentStream.readable).to.equal(true); // has not ended
        expect(contentStream.readableDidRead).to.equal(false); // was not read
        contentStream.destroy();
      });
    });

    describe('get', function () {
      before(async function () {
        this.username = 'automated-test-' + Math.round(Math.random() * Number.MAX_SAFE_INTEGER);
        await this.store.createUser({ username: this.username, email: 'l@m.no', password: '12345678' });
      });

      after(async function () {
        await this.store.deleteUser(this.username);
      });

      describe('for files', function () {
        describe('unversioned', function () {
          it('returns null for a non-existing path', async function () {
            const { status, readStream, contentType, contentLength, ETag } =
              await this.store.get(this.username, '/non-existing/non-existing', null);
            expect(status).to.equal(404);
            expect(readStream).to.equal(null);
            expect(contentLength).to.equal(null);
            expect(contentType).to.equal(null);
            expect(ETag).to.equal(null);
          });

          it('returns null for a non-existing path in an existing category', async function () {
            const content = 'filename';
            const [putStatus] = await this.store.put(this.username, '/existing/document', 'text/cache-manifest', content.length, Readable.from([content], { objectMode: false }), null);
            expect(putStatus).to.equal('CREATED');

            const { status, readStream, contentType, contentLength, ETag } =
              await this.store.get(this.username, '/existing/not-existing', null);
            expect(status).to.equal(404);
            expect(readStream).to.equal(null);
            expect(contentType).to.equal(null);
            expect(contentLength).to.equal(null);
            expect(ETag).to.equal(null);
          });
        });

        describe('versioned', function () {
          it('should return file for If-None-Match with old ETag', async function () {
            const content = 'VEVENT';
            const [putStatus, putETag] = await this.store.put(this.username, '/existing/file', 'text/calendar', content.length, Readable.from([content], { objectMode: false }), null);
            expect(putStatus).to.equal('CREATED');

            const { status, readStream, contentType, contentLength, ETag } =
              await this.store.get(this.username, '/existing/file', { name: 'If-None-Match', ETag: '"ljl365jj53l3l6"' });
            expect(status).to.equal(200);
            const retrievedContent = (await readStream.setEncoding('utf-8').toArray())[0];
            expect(retrievedContent).to.be.deep.equal(content);
            expect(contentType).to.equal('text/calendar');
            expect(contentLength).to.equal(content.length);
            expect(ETag).to.equal(putETag);
          });

          it('should return Not Modified for If-None-Match with matching ETag', async function () {
            const content = 'VEVENT';
            const [putStatus, putETag] = await this.store.put(this.username, '/existing/thing', 'text/plain', content.length, Readable.from([content], { objectMode: false }), null);
            expect(putStatus).to.equal('CREATED');

            const { status, readStream, ETag } =
              await this.store.get(this.username, '/existing/thing', { name: 'If-None-Match', ETag: putETag });
            expect(status).to.equal(304);
            expect(Boolean(readStream)).to.equal(false);
            expect(Boolean(ETag)).to.equal(false);
          });

          it('should return file for If-Match with matching ETag', async function () {
            const content = 'VEVENT';
            const [putStatus, putETag] = await this.store.put(this.username, '/existing/novel', 'text/calendar', content.length, Readable.from([content], { objectMode: false }), null);
            expect(putStatus).to.equal('CREATED');

            const { status, readStream, contentType, contentLength, ETag } =
              await this.store.get(this.username, '/existing/novel', { name: 'If-Match', ETag: putETag });
            expect(status).to.equal(200);
            const retrievedContent = (await readStream.setEncoding('utf-8').toArray())[0];
            expect(retrievedContent).to.be.deep.equal(content);
            expect(contentType).to.equal('text/calendar');
            expect(contentLength).to.equal(content.length);
            expect(ETag).to.equal(putETag);
          });

          it('should return Precondition Failed for If-Match with mismatched ETag', async function () {
            const content = 'VEVENT';
            const [putStatus] = await this.store.put(this.username, '/existing/short-story', 'text/plain', content.length, Readable.from([content], { objectMode: false }), null);
            expect(putStatus).to.equal('CREATED');

            const { status, readStream } =
              await this.store.get(this.username, '/existing/short-story', { name: 'If-Match', ETag: '"l6jl546jl453"' });
            expect(status).to.equal(412);
            expect(Boolean(readStream)).to.equal(false);
          });
        });
      });

      describe('for directories', function () {
        describe('unversioned', function () {
          it('returns null for a non-existing category', async function () {
            const { status, readStream, contentType, contentLength, ETag } =
              await this.store.get(this.username, '/non-existing-category/', null);
            expect(status).to.equal(404);
            expect(readStream).to.equal(null);
            expect(contentLength).to.equal(null);
            expect(contentType).to.equal(null);
            expect(ETag).to.equal(null);
          });

          it('returns null for a non-existing directory in non-existing category', async function () {
            const { status, readStream, contentType, contentLength, ETag } =
              await this.store.get(this.username, '/non-existing-category/non-existing-directory', null);
            expect(status).to.equal(404);
            expect(readStream).to.equal(null);
            expect(contentLength).to.equal(null);
            expect(contentType).to.equal(null);
            expect(ETag).to.equal(null);
          });

          it('returns remoteStorage directory in JSON-LD format', async function () {
            const content1 = 'yellow, red';
            const [result1, ETag1] = await this.store.put(this.username, '/color-category/color-directory/yellow-red', 'text/csv', content1.length, Readable.from([content1], { objectMode: false }), null);
            expect(result1).to.equal('CREATED');
            expect(ETag1).to.match(/^".{6,128}"$/);

            const content2 = 'blue & green';
            const [result2, ETag2] = await this.store.put(this.username, '/color-category/color-directory/blue-green', 'text/n3', content2.length, Readable.from([content2], { objectMode: false }), null);
            expect(result2).to.equal('CREATED');
            expect(ETag2).to.match(/^".{6,128}"$/);

            const content3 = 'purple -> ultraviolet';
            const [result3, ETag3] = await this.store.put(this.username, '/color-category/color-directory/subfolder/purple-ultraviolet', 'text/plain', content3.length, Readable.from([content3], { objectMode: false }), null);
            expect(result3).to.equal('CREATED');
            expect(ETag3).to.match(/^".{6,128}"$/);

            const { status, readStream, contentType, contentLength, ETag: directoryETag } = await this.store.get(this.username, '/color-category/color-directory/', null);
            expect(status).to.equal(200);
            expect(contentType).to.equal('application/ld+json');
            expect(contentLength).to.be.greaterThan(0);
            expect(directoryETag).to.match(/^".{6,128}"$/);
            const directory = JSON.parse((await readStream.setEncoding('utf-8').toArray())[0]);
            expect(directory['@context']).to.equal('http://remotestorage.io/spec/folder-description');
            expect(directory.items['yellow-red'].ETag).to.match(/^".{6,128}"$/);
            expect(directory.items['yellow-red']['Content-Type']).to.equal('text/csv');
            expect(directory.items['yellow-red']['Content-Length']).to.equal(content1.length);
            expect(Date.now() - new Date(directory.items['yellow-red']['Last-Modified'])).to.be.lessThan(9_000);
            expect(directory.items['blue-green'].ETag).to.match(/^".{6,128}"$/);
            expect(directory.items['blue-green']['Content-Type']).to.equal('text/n3');
            expect(directory.items['blue-green']['Content-Length']).to.equal(content2.length);
            expect(Date.now() - new Date(directory.items['blue-green']['Last-Modified'])).to.be.lessThan(9_000);
            expect(directory.items['subfolder/'].ETag).to.match(/^".{6,128}"$/);
          });
        });
        describe('versioned', function () {
          it('should return Not Modified when If-None-Match has a matching ETag', async function () {
            const content = 'gravel, sand';
            const [result, ETag] = await this.store.put(this.username, '/fill-category/fill-directory/gravel-sand', 'text/vnd.foo', content.length, Readable.from([content], { objectMode: false }), null);
            expect(result).to.equal('CREATED');
            expect(ETag).to.match(/^".{6,128}"$/);

            const { status, readStream, contentType, contentLength, ETag: directoryETag } = await this.store.get(this.username, '/fill-category/fill-directory/', null);
            expect(status).to.equal(200);
            expect(readStream).to.be.instanceof(Readable);
            expect(contentType).to.equal('application/ld+json');
            expect(contentLength).to.be.greaterThan(0);
            expect(directoryETag).to.match(/^".{6,128}"$/);

            const { status: status2, readStream: readStream2 } = await this.store.get(this.username, '/fill-category/fill-directory/', { name: 'If-None-Match', ETag: directoryETag });
            expect(status2).to.equal(304);
            expect(readStream2).to.be.null;
          });
        });
      });
    });

    describe.skip('delete', function () {
      before(async function () {
        this.username = 'automated-test-' + Math.round(Math.random() * Number.MAX_SAFE_INTEGER);
        await this.store.createUser({ username: this.username, email: 'l@m.no', password: '12345678' });
      });

      after(async function () {
        await this.store.deleteUser(this.username);
      });

      describe('unversioned', function () {
        it('should remove a file, empty parent directories, and remove directory entries', async function () {
          const content1 = 'wombat';
          const [result1, ETag1] = await this.store.put(this.username, '/animal/vertebrate/australia/marsupial/wombat', 'text/vnd.latex-z', content1.length, Readable.from([content1], { objectMode: false }), null);
          expect(result1).to.equal('CREATED');
          expect(ETag1).to.match(/^".{6,128}"$/);

          const content2 = 'Alpine Ibex';
          const [result2, ETag2] = await this.store.put(this.username, '/animal/vertebrate/europe/Capra ibex', 'text/vnd.abc', content2.length, Readable.from([content2], { objectMode: false }), null);
          expect(result2).to.equal('CREATED');
          expect(ETag2).to.match(/^".{6,128}"$/);

          const [deleteResult, deleteETag] = await this.store.delete(this.username, '/animal/vertebrate/australia/marsupial/wombat', null);
          expect(deleteResult).to.equal('DELETED');
          expect(deleteETag).to.equal(ETag1);

          const { status: status1, readStream: readStream1 } = await this.store.get(this.username, '/animal/vertebrate/australia/marsupial/wombat', null);
          expect(status1).to.equal(404);
          expect(Boolean(readStream1)).to.be.false;

          const { status: status2, readStream: readStream2 } = await this.store.get(this.username, '/animal/vertebrate/australia/marsupial/', null);
          expect(status2).to.equal(404);
          expect(Boolean(readStream2)).to.be.false;

          const { status: status3, readStream: readStream3 } = await this.store.get(this.username, '/animal/vertebrate/australia/', null);
          expect(status3).to.equal(200);
          expect(Boolean(readStream3)).to.be.false;

          const { status: status4, readStream: readStream4, contentType, contentLength, ETag: directoryETag } = await this.store.get(this.username, '/animal/vertebrate/', null);
          expect(status4).to.equal(200);
          expect(contentType).to.equal('application/ld+json');
          expect(contentLength).to.be.greaterThan(0);
          expect(directoryETag).to.match(/^".{6,128}"$/);
          const directory = JSON.parse((await readStream4.setEncoding('utf-8').toArray())[0]);
          expect(directory['@context']).to.equal('http://remotestorage.io/spec/folder-description');
          expect(directory.items['europe/'].ETag).to.match(/^".{6,128}"$/);
        });
      });
    });
  });
};
