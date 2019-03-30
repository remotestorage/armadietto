# Brainstorming

#### /.well-known/host-meta.json

```
'properties': {
  'overhide:remuneration-provider-uri:OH-LEDGER':'provider:...',
  'overhide:remuneration-provider-uri:OH-LEDGER-TEST':'provider:...',
  'overhide:remuneration-provider-uri:ETH':'provider:...',
  'overhide:remuneration-provider-uri:RINKEBY':'provider:...'
},
'links': [
  {
    'rel': 'lrdd',
    'template': host + '/overhide/jrd?resource={uri}'
  }
]
```

LRDDs supported:

* `provider=` + a value from one of `overhide:remuneration-provider-uri:*`

#### /.well-known/webfinger?resource={uri}

##### {uri} == overhide:broker:for:<user-address>

*user-address* -- https://github.com/overhide/overhide/blob/master/docs/glossary.md#user-address

  "remunerationKey": "..",
  "activeBrokerHost": "..",
  
*address* -- is the *user-address*


#### /overhide/jrd?resource={uri}

These are the LRDD URLs

##### {uri} == provider:...

```
'properties': {
  'overhide:remuneration-provider-url':'...',
  'overhide:remuneration-provider-ledger-address':'...',
  'overhide:remuneration-provider-tier:BASIC':'tier:...'
},
'links': [
  {
    'rel': 'lrdd',
    'template': host + '/overhide/jrd?resource={uri}'
  },
]
```

*overhide:remuneration-provider-url* -- URL of [remuneration provider](https://github.com/overhide/overhide/blob/master/docs/remuneration-api.md).

*overhide:remuneration-provider-ledger-address* -- This broker's specific public payment address with the reumneration provider. This is the public address to which a subscription payment needs to be made from a user identity.

LRDDs supported:

* `tier=` + a value from one of `overhide:remuneration-tier:*`

##### {uri} == tier:...

```
'properties': {
  'overhide:remuneration-tier-limit-bytes':'...',
  'overhide:remuneration-tier-value':'...',
  'overhide:remuneration-tier-within-seconds':'...'
}
```

*overhide:remuneration-tier-limit-bytes* -- Bytes of storage allowed for use at tier level.

*overhide:remuneration-tier-value* --  Amount of currency--as per remuneration-key required to access this segment-key.  A 0-value implies at least one transaction of any value (perhaps just the ledger transaction fees) must be present.

*overhide:remuneration-tier-within-seconds* -- All transactions--on the remuneration provider indicated with remuneration-key--with a timestamp more recent than within-seconds before the time of login, have their amounts tallied and compared to value. If the tally is at least value the entry-fee is met.

##### {uri} == overhide:service:...


##### {uri} == overhide:login:<remuneration-key>:<secret-phrase>:<>