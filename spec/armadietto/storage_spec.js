/* eslint-env mocha, chai, node */
const chai = require('chai');
const chaiHttp = require('chai-http');
const spies = require('chai-spies');
const expect = chai.expect;

const Armadietto = require('../../lib/armadietto');

chai.use(chaiHttp);
chai.use(spies);

const req = chai.request('http://localhost:4567');
let store = {
  get (username, path) {
    return {item: null, versionMatch: true};
  },
  permissions (user, token) {
    if (user === 'boris' && token === 'a_token') return false;
    if (user === 'zebcoe' && token === 'a_token') {
      return {
        '/locog/': ['r', 'w'],
        '/books/': ['r'],
        '/statuses/': ['w'],
        '/deep/dir/': ['r', 'w']
      };
    }
    if (user === 'zebcoe' && token === 'root_token') return { '/': ['r', 'r'] };
    if (user === 'zebcoe' && token === 'bad_token') return false;
  }
};

const sandbox = chai.spy.sandbox();

before(() => {
  this._server = new Armadietto({ store, http: { port: 4567 } });
  this._server.boot();
});

after(() => { this._server.stop(); });

describe('Storage', () => {
  it('returns a 400 if the client uses path traversal in the path', async () => {
    const res = await req.get('/storage/zebcoe/locog/../seats');
    expect(res).to.have.status(400);
    expect(res).to.have.header('Access-Control-Allow-Origin', '*');
  });

  it('returns a 400 if the client uses invalid characters in the path', async () => {
    const res = await req.get('/storage/zebcoe/locog/$eats');
    expect(res).to.have.status(400);
    expect(res).to.have.header('Access-Control-Allow-Origin', '*');
  });

  it('returns a 400 if the client uses a zero-length path', async () => {
    const res = await req.get('/storage/zebcoe');
    expect(res).to.have.status(400);
    expect(res).to.have.header('Access-Control-Allow-Origin', '*');
  });
});

describe('OPTIONS', () => {
  it('returns access control headers', async () => {
    const res = await req.options('/storage/zebcoe/locog/seats');
    expect(res).to.have.status(200);
    expect(res).to.have.header('Access-Control-Allow-Origin', '*');
    expect(res).to.have.header('Access-Control-Allow-Headers', 'Authorization, Content-Length, Content-Type, If-Match, If-None-Match, Origin, X-Requested-With');
    expect(res).to.have.header('Access-Control-Allow-Methods', 'OPTIONS, GET, HEAD, PUT, DELETE');
    expect(res).to.have.header('Access-Control-Expose-Headers', 'Content-Length, Content-Type, ETag');
    expect(res).to.have.header('Cache-Control', 'no-cache, no-store');
    // check if body is empty
  });
});

describe('GET', () => {
  const modifiedTimestamp = Date.UTC(2012, 1, 25, 13, 37);

  describe('when a valid access token is used', () => {

    afterEach(() => {
      sandbox.restore();
    });

    beforeEach(() => {
      sandbox.on(store, ['get']);
    });


    let get = async (path) => {
      const ret = await req.get(path)
        .set('Authorization', 'Bearer a_token').send();
      return ret;
    };

    it('asks the store for the item', async () => {
      await get('/storage/zebcoe@local.dev/locog/seats');
      expect(store.get).to.have.been.called.with('zebcoe', '/locog/seats');
    });

    it('asks the store for items containing dots', async () => {
      await get('/storage/zebcoe@local.dev/locog/seats.gif');
      expect(store.get).to.have.been.called.with('zebcoe', '/locog/seats.gif');
    });

    it('asks the store for a deep item', async () => {
      await get('/storage/zebcoe@local.dev/deep/dir/value')
      expect(store.get).to.have.been.called.with('zebcoe', '/deep/dir/value');
    });

    it('passes the path literally to the store', async () => {
      await get('/storage/zebcoe/locog/a%2Fpath')
      expect(store.get).to.have.been.called.with('zebcoe', '/locog/a%2Fpath');
    });

    it('ask the store for a directory listing', async () => {
      await get('/storage/zebcoe/locog/')
      expect(store.get).to.have.been.called.with('zebcoe', '/locog/');
    });

    it('ask the store for a deep directory listing', async () => {
      await get('/storage/zebcoe/deep/dir/')
      expect(store.get).to.have.been.called.with('zebcoe', '/deep/dir/');
    });

    it('ask the store for a root listing with unauthorized token', async () => {
      await get('/storage/zebcoe/')
      expect(store.get).to.have.been.called.exactly(0);
    });

    it('ask the store for a root listing', async () => {
      await req.get('/storage/zebcoe/')
        .set('Authorization', 'Bearer root_token').send();
      expect(store.get).to.have.been.called.with('zebcoe', '/');
    });

    it('ask the store for an item conditionally based on If-None-Match', async () => {
      await req.get('/storage/zebcoe/locog/seats')
        .set('Authorization', 'Bearer a_token')
        .set('If-None-Match', modifiedTimestamp).send();
      expect(store.get).to.have.been.called.with('zebcoe', '/locog/seats', modifiedTimestamp);
    });

    it('do not ask the store for an item in an unauthorized directory', async () => {
      await get('/storage/zebcoe/jsconf/tickets');
      expect(store.get).to.have.been.called.exactly(0);
    });

    it('do not ask the store for an item in an too-broad directory', async () => {
      await get('/storage/zebcoe/deep/nothing');
      expect(store.get).to.have.been.called.exactly(0);
    });

    it('do not ask the store for an unauthorized directory', async () => {
      await get('/storage/zebcoe/deep/');
      expect(store.get).to.have.been.called.exactly(0);
    });

    
    it('do not ask the store for an item in a read-unauthorized directory', async () => {
      await get('/storage/zebcoe/statues/first');
      expect(store.get).to.have.been.called.exactly(0);
    });


    it('do not ask the store for an item of another user', async () => {
      await get('/storage/boris/locog/seats');
      expect(store.get).to.have.been.called.exactly(0);
    });
  });

  describe("when an invalid access token is used", () => {

    afterEach(() => {
      sandbox.restore();
    });

    beforeEach(() => {
      sandbox.on(store, ['get']);
    });


    let get = async (path) => {
      const ret = await req.get(path)
        .set('Authorization', 'Bearer bad_token').send();
      return ret;
    };


    it("does not ask the store for the item", async () => {
      await get( "/storage/zebcoe/locog/seats" );
      expect(store.get).to.have.been.called.exactly(0)
    });

    it("asks the store for a public item", async () => {
      await get( "/storage/zebcoe/public/locog/seats" )
      expect(store.get).to.have.been.called.with("zebcoe", "/public/locog/seats")
    });

    it("does not ask the store for a public directory", async () => {
      await get( "/storage/zebcoe/public/locog/seats/" );
      expect(store.get).to.have.been.called.exactly(0);
    });

    it("returns an OAuth error", async () => {
      const res = await get( "/storage/zebcoe/locog/seats" );
      expect(res).to.have.status( 401 );
      expect(res).to.have.header( "Access-Control-Allow-Origin", "*" );
      expect(res).to.have.header( "Cache-Control", "no-cache, no-store" );
      expect(res).to.have.header( "WWW-Authenticate", 'Bearer realm="localhost:4567" error="invalid_token"' );
    })
  })



});


//     describe("when the store returns an item", function() { with(this) {
//       before(function() { with(this) {
//         header( "Authorization", "Bearer a_token" )
//       }})

//       it("returns the value in the response", function() { with(this) {
//         stub(store, "get").yields([null, item])
//         get( "/storage/zebcoe/locog/seats", {} )
//         check_status( 200 )
//         check_header( "Access-Control-Allow-Origin", "*" )
//         check_header( "Cache-Control", "no-cache, no-store" )
//         check_header( "Content-Length", "7" )
//         check_header( "Content-Type", "custom/type" )
//         check_header( "ETag", '"1330177020000"' )
//         check_body( buffer("a value") )
//       }})

//       it("returns a 412 for a failed conditional", function() { with(this) {
//         stub(store, "get").yields([null, item, true])
//         get( "/storage/zebcoe/locog/seats", {} )
//         check_status( 304 )
//         check_header( "Access-Control-Allow-Origin", "*" )
//         check_header( "Cache-Control", "no-cache, no-store" )
//         check_header( "ETag", '"1330177020000"' )
//         check_body( "" )
//       }})
//     }})

//     describe("when the store returns a directory listing", function() { with(this) {
//       before(function() { with(this) {
//         header( "Authorization", "Bearer a_token" )
//         stub(store, "get").yields([null, { children: [{name: "bla", modified: 1234544444}, {name: "bar/", modified: 12345888888}], modified: 12345888888 }])
//       }})

//       it("returns the listing as JSON", function() { with(this) {
//         get( "/storage/zebcoe/locog/seats/", {} )
//         check_status( 200 )
//         check_header( "Access-Control-Allow-Origin", "*" )
//         check_header( "Cache-Control", "no-cache, no-store" )
//         check_header( "ETag", '"12345888888"' )
//         check_json( {"bar/": "12345888888", "bla": "1234544444"} )
//       }})
//     }})

//     describe("when the store returns an empty directory listing", function() { with(this) {
//       before(function() { with(this) {
//         header( "Authorization", "Bearer a_token" )
//         stub(store, "get").yields([null, { children: [], modified: 12345888888 }])
//       }})

//       it("returns a 200 response with an empty JSON object", function() { with(this) {
//         get( "/storage/zebcoe/locog/seats/", {} )
//         check_status( 200 )
//         check_header( "Access-Control-Allow-Origin", "*" )
//         check_header( "Cache-Control", "no-cache, no-store" )
//         check_header( "ETag", '"12345888888"' )
//         check_json( {} )
//       }})
//     }})

//     describe("when the item does not exist", function() { with(this) {
//       before(function() { with(this) {
//         header( "Authorization", "Bearer a_token" )
//         stub(store, "get").yields([null, undefined])
//       }})

//       it("returns an empty 404 response", function() { with(this) {
//         get( "/storage/zebcoe/locog/seats", {} )
//         check_status( 404 )
//         check_header( "Access-Control-Allow-Origin", "*" )
//         check_body( "" )
//       }})
//     }})

//     describe("when the store returns an error", function() { with(this) {
//       before(function() { with(this) {
//         header( "Authorization", "Bearer a_token" )
//         stub(store, "get").yields([new Error("We did something wrong")])
//       }})

//       it("returns a 500 response with the error message", function() { with(this) {
//         get( "/storage/zebcoe/locog/seats", {} )
//         check_status( 500 )
//         check_header( "Access-Control-Allow-Origin", "*" )
//         check_body( "We did something wrong" )
//       }})
//     }})
//   }})

//   describe("PUT", function() { with(this) {
//     describe("when a valid access token is used", function() { with(this) {
//       before(function() { with(this) {
//         header( "Authorization", "Bearer a_token" )
//       }})

//       it("tells the store to save the given value", function() { with(this) {
//         expect(store, "put").given("zebcoe", "/locog/seats", "text/plain", buffer("a value"), null).yielding([null])
//         put( "/storage/zebcoe/locog/seats", "a value" )
//       }})

//       it("tells the store to save a public value", function() { with(this) {
//         expect(store, "put").given("zebcoe", "/public/locog/seats", "text/plain", buffer("a value"), null).yielding([null])
//         put( "/storage/zebcoe/public/locog/seats", "a value" )
//       }})

//       it("tells the store to save a value conditionally based on If-None-Match", function() { with(this) {
//         expect(store, "put").given("zebcoe", "/locog/seats", "text/plain", buffer("a value"), modifiedTimestamp).yielding([null])
//         header( "If-None-Match", '"' + modifiedTimestamp + '"' )
//         put( "/storage/zebcoe/locog/seats", "a value" )
//       }})

//       it("tells the store to create a value conditionally based on If-None-Match", function() { with(this) {
//         expect(store, "put").given("zebcoe", "/locog/seats", "text/plain", buffer("a value"), "*").yielding([null])
//         header( "If-None-Match", "*" )
//         put( "/storage/zebcoe/locog/seats", "a value" )
//       }})

//       it("tells the store to save a value conditionally based on If-Match", function() { with(this) {
//         expect(store, "put").given("zebcoe", "/locog/seats", "text/plain", buffer("a value"), modifiedTimestamp).yielding([null])
//         header( "If-Match", '"' + modifiedTimestamp + '"' )
//         put( "/storage/zebcoe/locog/seats", "a value" )
//       }})

//       it("does not tell the store to save a directory", function() { with(this) {
//         expect(store, "put").exactly(0)
//         put( "/storage/zebcoe/locog/seats/", "a value" )
//       }})

//       it("does not tell the store to save to a write-unauthorized directory", function() { with(this) {
//         expect(store, "put").exactly(0)
//         put( "/storage/zebcoe/books/house_of_leaves", "a value" )
//       }})
//     }})

//     describe("when an invalid access token is used", function() { with(this) {
//       before(function() { with(this) {
//         header( "Authorization", "Bearer bad_token" )
//       }})

//       it("does not tell the store to save the given value", function() { with(this) {
//         expect(store, "put").exactly(0)
//         put( "/storage/zebcoe/locog/seats", "a value" )
//       }})
//     }})

//     describe("when the store says the item was created", function() { with(this) {
//       before(function() { with(this) {
//         header( "Authorization", "Bearer a_token" )
//         stub(store, "put").yields([null, true, 1347016875231])
//       }})

//       it("returns an empty 201 response", function() { with(this) {
//         put( "/storage/zebcoe/locog/seats", "a value" )
//         check_status( 201 )
//         check_header( "Access-Control-Allow-Origin", "*" )
//         check_header( "ETag", '"1347016875231"' )
//         check_body( "" )
//       }})
//     }})

//     describe("when the store says the item was not created but updated", function() { with(this) {
//       before(function() { with(this) {
//         header( "Authorization", "Bearer a_token" )
//         stub(store, "put").yields([null, false, 1347016875231])
//       }})

//       it("returns an empty 200 response", function() { with(this) {
//         put( "/storage/zebcoe/locog/seats", "a value" )
//         check_status( 200 )
//         check_header( "Access-Control-Allow-Origin", "*" )
//         check_header( "ETag", '"1347016875231"' )
//         check_body( "" )
//       }})
//     }})

//     describe("when the store says there was a version conflict", function() { with(this) {
//       before(function() { with(this) {
//         header( "Authorization", "Bearer a_token" )
//         stub(store, "put").yields([null, false, 1347016875231, true])
//       }})

//       it("returns an empty 412 response", function() { with(this) {
//         put( "/storage/zebcoe/locog/seats", "a value" )
//         check_status( 412 )
//         check_header( "Access-Control-Allow-Origin", "*" )
//         check_header( "ETag", '"1347016875231"' )
//         check_body( "" )
//       }})
//     }})

//     describe("when the store returns an error", function() { with(this) {
//       before(function() { with(this) {
//         header( "Authorization", "Bearer a_token" )
//         stub(store, "put").yields([new Error("Something is technically wrong")])
//       }})

//       it("returns a 500 response with the error message", function() { with(this) {
//         put( "/storage/zebcoe/locog/seats", "a value" )
//         check_status( 500 )
//         check_header( "Access-Control-Allow-Origin", "*" )
//         check_body( "Something is technically wrong" )
//       }})
//     }})
//   }})

//   describe("DELETE", function() { with(this) {
//     before(function() { with(this) {
//       header( "Authorization", "Bearer a_token" )
//     }})

//     it("tells the store to delete the given item", function() { with(this) {
//       expect(store, "delete").given("zebcoe", "/locog/seats", null).yielding([null])
//       this.delete( "/storage/zebcoe/locog/seats", {} )
//     }})

//     it("tells the store to delete an item conditionally based on If-None-Match", function() { with(this) {
//       expect(store, "delete").given("zebcoe", "/locog/seats", modifiedTimestamp).yielding([null])
//       header( "If-None-Match", '"' + modifiedTimestamp + '"' )
//       this.delete( "/storage/zebcoe/locog/seats", {} )
//     }})

//     it("tells the store to delete an item conditionally based on If-Match", function() { with(this) {
//       expect(store, "delete").given("zebcoe", "/locog/seats", modifiedTimestamp).yielding([null])
//       header( "If-Match", '"' + modifiedTimestamp + '"' )
//       this.delete( "/storage/zebcoe/locog/seats", {} )
//     }})

//     describe("when the store says the item was deleted", function() { with(this) {
//       before(function() { with(this) {
//         stub(store, "delete").yields([null, true, 1358121717830])
//       }})

//       it("returns an empty 200 response", function() { with(this) {
//         this.delete( "/storage/zebcoe/locog/seats", {} )
//         check_status( 200 )
//         check_header( "Access-Control-Allow-Origin", "*" )
//         check_header( "ETag", '"1358121717830"' )
//         check_body( "" )
//       }})
//     }})

//     describe("when the store says the item was not deleted", function() { with(this) {
//       before(function() { with(this) {
//         stub(store, "delete").yields([null, false, 1358121717830])
//       }})

//       it("returns an empty 404 response", function() { with(this) {
//         this.delete( "/storage/zebcoe/locog/seats", {} )
//         check_status( 404 )
//         check_header( "Access-Control-Allow-Origin", "*" )
//         check_body( "" )
//       }})
//     }})

//     describe("when the store says there was a version conflict", function() { with(this) {
//       before(function() { with(this) {
//         stub(store, "delete").yields([null, false, 1358121717830, true])
//       }})

//       it("returns an empty 412 response", function() { with(this) {
//         this.delete( "/storage/zebcoe/locog/seats", {} )
//         check_status( 412 )
//         check_header( "Access-Control-Allow-Origin", "*" )
//         check_body( "" )
//       }})
//     }})

//     describe("when the store returns an error", function() { with(this) {
//       before(function() { with(this) {
//         stub(store, "delete").yields([new Error("OH NOES!")])
//       }})

//       it("returns a 500 response with the error message", function() { with(this) {
//         this.delete( "/storage/zebcoe/locog/seats", {} )
//         check_status( 500 )
//         check_header( "Access-Control-Allow-Origin", "*" )
//         check_body( "OH NOES!" )
//       }})
//     }})
//   }})
// }})
