# Cavendish Maintenance

## MacOS (Darwin)

### Build

```sh
$ git clone git@github.com:provenance-io/provenance.git
$ cd provenance
$ git checkout v1.7.5
$ make build
```

Copy `build/provenanced` to `bin/x64/darwin/provenanced`.

### Copy dylibs

In the cavendish directory:

```sh
$ cp -L /usr/local/opt/leveldb/lib/libleveldb.1.dylib ./bin/x64/darwin
$ cp -L /usr/local/opt/snappy/lib/libsnappy.1.dylib ./bin/x64/darwin
$ cp -L /usr/local/opt/gperftools/lib/libtcmalloc.4.dylib ./bin/x64/darwin
$ cp ~/go/pkg/mod/github.com/\!cosm\!wasm/wasmvm@v0.16.0/api/libwasmvm.dylib ./bin/x64/darwin
```

### Update dylib paths

In the cavendish directory:

```sh
$ install_name_tool -change \
    /usr/local/opt/leveldb/lib/libleveldb.1.dylib \
    @rpath/libleveldb.1.dylib \
    bin/x64/darwin/provenanced

$ install_name_tool -change \
    /usr/local/opt/snappy/lib/libsnappy.1.dylib \
    @rpath/libsnappy.1.dylib \
    bin/x64/darwin/libleveldb.1.dylib

$ install_name_tool -change \
    /usr/local/opt/gperftools/lib/libtcmalloc.4.dylib \
    @rpath/libtcmalloc.4.dylib \
    bin/x64/darwin/libleveldb.1.dylib
```

## Linux

???
