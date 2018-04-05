const fs = require("fs");
const path = require("path");

describe("Stores", () => {
  sharedBehavior("storage backend", () => {
    define("buffer", (string) => {
      var buffer = new Buffer(string)
      buffer.equals = function(other) {
        return other instanceof Buffer && other.toString("utf8") === string
      }
      return buffer
    })

    define("file", (filename) => {
      var buffer = fs.readFileSync(path.join(__dirname, filename)),
          string = buffer.toString("hex")

      buffer.equals = (other) => {
        return other instanceof Buffer && other.toString("hex") === string
      }
      return buffer
    })

    describe("createUser", () => {
      before(() => {
        this.params = {username: "zebcoe", email: "zeb@example.com", password: "locog"};
      });

      describe("with valid parameters", () => {
        it("returns no errors", () => {
          store.createUser(params, function(error) {
            resume(() => { assertNull( error ) })
          })
        })
      })

      describe("with no username", () => {
        before(() => { delete this.params.username })

        it("returns an error", () => {
          store.createUser(params, function(error) {
            resume(() => { assertEqual( "Username must be at least 2 characters long", error.message ) })
          })
        })
      })

      describe("with no email", () => {
        before(() => { delete this.params.email })

        it("returns an error", () => {
          store.createUser(params, function(error) {
            resume(() => { assertEqual( "Email must not be blank", error.message ) })
          })
        })
      })

      describe("with no password", () => {
        before(() => { delete this.params.password })

        it("returns an error", () => {
          store.createUser(params, function(error) {
            resume(() => { assertEqual( "Password must not be blank", error.message ) })
          })
        })
      })

      describe("with an existing user", () => {
        before(() => {
          store.createUser({username: "zebcoe", email: "zeb@example.com", password: "hi"}, resume)
        })

        it("returns an error", () => {
          store.createUser(params, function(error) {
            resume(() => { assertEqual( "The username is already taken", error.message ) })
          })
        })
      })
    })

    describe("authenticate", () => {
      before(() => {
        store.createUser({username: "boris", email: "boris@example.com", password: "zipwire"}, resume)
      })

      it("returns no error for valid username-password pairs", () => {
        store.authenticate({username: "boris", password: "zipwire"}, function(error) {
          resume(() => { assertNull( error ) })
        })
      })

      it("returns an error if the password is wrong", () => {
        store.authenticate({username: "boris", password: "bikes"}, function(error) {
          resume(() => { assertEqual( "Incorrect password", error.message ) })
        })
      })

      it("returns an error if the user does not exist", () => {
        store.authenticate({username: "zeb", password: "zipwire"}, function(error) {
          resume(() => { assertEqual( "Username not found", error.message ) })
        })
      })
    })

    describe("authorization methods", () => {
      before(() => {
        this.token = null
        this.rootToken = null
        var permissions = {documents: ["w"], photos: ["r","w"], contacts: ["r"], "deep/dir": ["r","w"]}

        store.createUser({username: "boris", email: "boris@example.com", password: "dangle"}, () => {
          store.authorize("www.example.com", "boris", permissions, function(error, accessToken) {
            token = accessToken
            store.createUser({username: "zebcoe", email: "zeb@example.com", password: "locog"}, () => {
              store.authorize("admin.example.com", "zebcoe", {"": ["r","w"]}, function(error, accessToken) {
                rootToken = accessToken
                resume()
              })
            })
          })
        })
      })

      describe("permissions", () => {
        it("returns the user's authorizations", () => {
          store.permissions("boris", token, function(error, auths) {
            resume(() => {
              assertEqual( {
                  "/contacts/":   ["r"],
                  "/deep/dir/":   ["r","w"],
                  "/documents/":  ["w"],
                  "/photos/":     ["r","w"]
                }, auths )
            })
          })
        })
      })

      describe("revokeAccess", () => {
        before(() => {
          store.revokeAccess("boris", token, resume)
        })

        it("removes the authorization from the store", () => {
          store.permissions("boris", token, function(error, auths) {
            resume(() => {
              assertEqual( {}, auths )
            })
          })
        })
      }})
    }})

    describe("storage methods", () => {
      before(() => {
        this.date = Date.UTC(2012,1,25,13,37)
        this.oldDate = Date.UTC(1984,6,5,11,11)
        stub("new", "Date").returns({getTime: () => { return date }})
        stub(Date, "now").returns(date) // make Node 0.9 happy
      }})

      describe("put", () => {
        before(() => {
          store.put("boris", "/photos/election", "image/jpeg", buffer("hair"), null, () => { resume() })
        }})

        it("sets the value of an item", () => {
          store.put("boris", "/photos/zipwire", "image/poster", buffer("vertibo"), null, () => {
            store.get("boris", "/photos/zipwire", null, function(error, item) {
              resume(() => { assertEqual( buffer("vertibo"), item.value ) })
            })
          })
        }})

        it("stores binary data", () => {
          store.put("boris", "/photos/whut", "image/jpeg", file("whut2.jpg"), null, () => {
            store.get("boris", "/photos/whut", null, function(error, item) {
              resume(() => { assertEqual( file("whut2.jpg"), item.value ) })
            })
          })
        }})

        it("sets the value of a public item", () => {
          store.put("boris", "/public/photos/zipwire", "image/poster", buffer("vertibo"), null, () => {
            store.get("boris", "/public/photos/zipwire", null, function(error, item) {
              resume(() => {
                assertEqual( buffer("vertibo"), item.value )
                store.get("boris", "/photos/zipwire", null, function(error, item) {
                  resume(() => { assertNull( item ) })
                })
              })
            })
          })
        }})

        it("sets the value of a root item", () => {
          store.put("zebcoe", "/manifesto", "text/plain", buffer("gizmos"), null, () => {
            store.get("zebcoe", "/manifesto", null, function(error, item) {
              resume(() => { assertEqual( buffer("gizmos"), item.value ) })
            })
          })
        }})

        it("sets the value of a deep item", () => {
          store.put("boris", "/deep/dir/secret", "text/plain", buffer("gizmos"), null, () => {
            store.get("boris", "/deep/dir/secret", null, function(error, item) {
              resume(() => { assertEqual( buffer("gizmos"), item.value ) })
            })
          })
        }})

        it("returns true with a timestamp when a new item is created", () => {
          store.put("boris", "/photos/zipwire", "image/poster", buffer("vertibo"), null, function(error, created, modified, conflict) {
            resume(() => {
              assertNull( error )
              assert( created )
              assertEqual( date, modified )
              assert( !conflict )
            })
          })
        }})

        it("returns true with a timestamp when a new category is created", () => {
          store.put("boris", "/documents/zipwire", "image/poster", buffer("vertibo"), null, function(error, created, modified, conflict) {
            resume(() => {
              assertNull( error )
              assert( created )
              assertEqual( date, modified )
              assert( !conflict )
            })
          })
        }})

        it("returns false with a timestamp when an existing item is modified", () => {
          store.put("boris", "/photos/election", "text/plain", buffer("hair"), null, function(error, created, modified, conflict) {
            resume(() => {
              assertNull( error )
              assert( !created )
              assertEqual( date, modified )
              assert( !conflict )
            })
          })
        }})

        describe("for a nested document", () => {
          before(() => {
            store.put("boris", "/photos/foo/bar/qux", "image/poster", buffer("vertibo"), null, resume)
          }})

          it("creates the parent directory", () => {
            store.get("boris", "/photos/foo/bar/", null, function(error, items) {
              resume(() => {
                assertEqual( { children: [{name: "qux", modified: date}], modified: date }, items )
              })
            })
          }})

          it("creates the grandparent directory", () => {
            store.get("boris", "/photos/foo/", null, function(error, items) {
              resume(() => {
                assertEqual( { children: [{name: "bar/", modified: date}], modified: date }, items )
              })
            })
          }})
        }})

        describe("versioning", () => {
          it("does not set the value if a version is given for a non-existent item", () => {
            store.put("boris", "/photos/zipwire", "image/poster", buffer("vertibo"), date, () => {
              store.get("boris", "/photos/zipwire", null, function(error, item) {
                resume(() => { assertNull( item ) })
              })
            })
          }})

          it("sets the value if * is given for a non-existent item", () => {
            store.put("boris", "/photos/zipwire", "image/poster", buffer("vertibo"), "*", () => {
              store.get("boris", "/photos/zipwire", null, function(error, item) {
                resume(() => { assertEqual( buffer("vertibo"), item.value ) })
              })
            })
          }})

          it("sets the value if the given version is current", () => {
            store.put("boris", "/photos/election", "image/jpeg", buffer("mayor"), date, () => {
              store.get("boris", "/photos/election", null, function(error, item) {
                resume(() => { assertEqual( buffer("mayor"), item.value ) })
              })
            })
          }})

          it("does not set the value if the given version is not current", () => {
            store.put("boris", "/photos/election", "image/jpeg", buffer("mayor"), oldDate, () => {
              store.get("boris", "/photos/election", null, function(error, item) {
                resume(() => { assertEqual( buffer("hair"), item.value ) })
              })
            })
          }})

          it("does not set the value if * is given for an existing item", () => {
            store.put("boris", "/photos/election", "image/jpeg", buffer("mayor"), "*", () => {
              store.get("boris", "/photos/election", null, function(error, item) {
                resume(() => { assertEqual( buffer("hair"), item.value ) })
              })
            })
          }})
 
          it("returns false with no conflict when the given version is current", () => {
            store.put("boris", "/photos/election", "image/jpeg", buffer("mayor"), date, function(error, created, modified, conflict) {
              resume(() => {
                assertNull( error )
                assert( !created )
                assertEqual( date, modified )
                assert( !conflict )
              })
            })
          }})

          it("returns false with a conflict when the given version is not current", () => {
            store.put("boris", "/photos/election", "image/jpeg", buffer("mayor"), oldDate, function(error, created, modified, conflict) {
              resume(() => {
                assertNull( error )
                assert( !created )
                assertNull( modified )
                assert( conflict )
              })
            })
          }})
        }})
      }})

      describe("get", () => {
        describe("for documents", () => {
          before(() => {
            store.put("boris", "/photos/zipwire", "image/poster", buffer("vertibo"), null, resume)
          }})

          it("returns an existing resource", () => {
            store.get("boris", "/photos/zipwire", null, function(error, item, match) {
              resume(() => {
                assertNull( error )
                assertEqual( {length: 7, type: "image/poster", modified: date, value: buffer("vertibo")}, item )
                assert( !match )
              })
            })
          }})

          it("returns null for a non-existant key", () => {
            store.get("boris", "/photos/lympics", null, function(error, item, match) {
              resume(() => {
                assertNull( error )
                assertNull( item )
                assert( !match )
              })
            })
          }})

          it("returns null for a non-existant category", () => {
            store.get("boris", "/madeup/lympics", null, function(error, item, match) {
              resume(() => {
                assertNull( error )
                assertNull( item )
                assert( !match )
              })
            })
          }})

          describe("versioning", () => {
            it("returns a match if the given version is current", () => {
              store.get("boris", "/photos/zipwire", date, function(error, item, match) {
                resume(() => {
                  assertNull( error )
                  assertEqual( {length: 7, type: "image/poster", modified: date, value: buffer("vertibo")}, item )
                  assert( match )
                })
              })
            }})

            it("returns no match if the given version is not current", () => {
              store.get("boris", "/photos/zipwire", oldDate, function(error, item, match) {
                resume(() => {
                  assertNull( error )
                  assertEqual( {length: 7, type: "image/poster", modified: date, value: buffer("vertibo")}, item )
                  assert( !match )
                })
              })
            }})
          }})
        }})

        describe("for directories", () => {
          before(() => {
            // Example data taken from http://www.w3.org/community/unhosted/wiki/RemoteStorage-2012.04#GET
            store.put("boris", "/photos/bar/qux/boo", "text/plain", buffer("some content"), null, () => {
              store.put("boris", "/photos/bla", "application/json", buffer('{"more": "content"}'), null, () => {
                store.put("zebcoe", "/tv/shows", "application/json", buffer('{"The Day": "Today"}'), null, resume)
              })
            })
          }})

          it("returns a directory listing for a category", () => {
            store.get("boris", "/photos/", null, function(error, items) {
              resume(() => {
                assertNull( error )
                assertEqual( { children: [{name: "bar/", modified: date}, {name: "bla", modified: date}], modified: date }, items )
              })
            })
          }})

          it("returns a directory listing for the root category", () => {
            store.get("zebcoe", "/", null, function(error, items) {
              resume(() => {
                assertNull( error )
                assertEqual( { children: [{name: "tv/", modified: date}], modified: date }, items )
              })
            })
          }})

          it("returns null for a non-existant directory", () => {
            store.get("boris", "/photos/foo/", null, function(error, items) {
              resume(() => {
                assertNull( error )
                assertEqual( null, items )
              })
            })
          }})

          describe("with a document with the same name as a directory", () => {
            before(() => {
              store.put("boris", "/photos.d", "application/json", buffer('{"The Day": "Today"}'), null, function(error) {
                resume(() => { assertNull( error ) })
              })
            }})

            it("returns a directory listing for a category", () => {
              store.get("boris", "/photos/", null, function(error, items) {
                resume(() => {
                  assertNull( error )
                  assertEqual( { children: [{name: "bar/", modified: date}, {name: "bla", modified: date}], modified: date }, items )
                })
              })
            }})
          }})
        }})
      }})

      describe("delete", () => {
        before(() => {
          store.put("boris", "/photos/election", "image/jpeg", buffer("hair"), null, () => {
            store.put("boris", "/photos/bar/qux/boo", "text/plain", buffer("some content"), null, resume)
          })
        }})

        it("deletes an item", () => {
          store.delete("boris", "/photos/election", null, () => {
            store.get("boris", "/photos/election", null, function(error, item) {
              resume(() => { assertNull( item ) })
            })
          })
        }})

        it("removes empty directories when items are deleted", () => {
          store.delete("boris", "/photos/bar/qux/boo", null, () => {
            store.get("boris", "/photos/", null, function(error, items) {
              resume(() => {
                assertNotEqual( arrayIncluding(objectIncluding({name: "bar/"})), items.children )
              })
            })
          })
        }})

        it("returns true when an existing item is deleted", () => {
          store.delete("boris", "/photos/election", null, function(error, deleted, modified, conflict) {
            resume(() => {
              assertNull( error )
              assert( deleted )
              assertEqual( date, modified )
              assert( !conflict )
            })
          })
        }})

        it("returns false when a non-existant item is deleted", () => {
          store.delete("boris", "/photos/zipwire", null, function(error, deleted, modified, conflict) {
            resume(() => {
              assertNull( error )
              assert( !deleted )
              assertNull( modified )
              assert( !conflict )
            })
          })
        }})

        describe("versioning", () => {
          it("deletes the item if the given version is current", () => {
            store.delete("boris", "/photos/election", date, () => {
              store.get("boris", "/photos/election", null, function(error, item) {
                resume(() => { assertNull( item ) })
              })
            })
          }})

          it("does not delete the item if the given version is not current", () => {
            store.delete("boris", "/photos/election", oldDate, () => {
              store.get("boris", "/photos/election", null, function(error, item) {
                resume(() => { assertEqual( buffer("hair"), item.value ) })
              })
            })
          }})

          it("returns true with no conflict if the given version is current", () => {
            store.delete("boris", "/photos/election", date, function(error, deleted, modified, conflict) {
              resume(() => {
                assertNull( error )
                assert( deleted )
                assertEqual( date, modified )
                assert( !conflict )
              })
            })
          }});
 
          it("returns false with a conflict if the given version is not current", () => {
            store.delete("boris", "/photos/election", oldDate, function(error, deleted, modified, conflict) {
              resume(() => {
                assertNull( error )
                assert( !deleted )
                assertNull( modified )
                assert( conflict )
              })
            })
          }})
        }})
      }})
    }})
  }})
}})
