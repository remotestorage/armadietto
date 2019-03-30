# URLs and Specs

The following URLs are implemented by the server.

## Common Conventions

Most payloads confirm to [JRD](https://www.packetizer.com/json/jrd/) format.

Most interrogation endpoints return links with Link Based Resource Descriptor Documents (LRDD) - descriptor documents providing resource-specific information, typically information that cannot be expressed using link templates.

```
'links': [
  {
    'rel': 'lrdd',
    'template': host + '/webfinger/jrd?resource={uri}'
  }
]
```

The *template* indicates how to retrieve the more beefy resource descriptor.



#### /.well-known/webfinger

Spec: https://tools.ietf.org/html/rfc7033

#### /.well-known/host-meta.json

Spec: https://tools.ietf.org/html/rfc6415

#### 

Spec: https://github.com/remotestorage/spec/blob/master/source.txt