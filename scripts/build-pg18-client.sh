#!/bin/sh
# Reproducible user-space build of the PostgreSQL 18 CLIENT tools (pg_dump, pg_restore, psql) for restore proofs on a
# developer Mac. Official source tarball pinned by SHA-256; installs only under .local/pg-client-18.6; no sudo, no system
# paths, no existing toolchain is replaced. Built with zlib (the default custom-format compression) and without OpenSSL,
# so it can restore into a loopback database but cannot make a TLS connection: the Production dump itself runs in the
# pinned container of the Production Backup workflow.
set -eu
VERSION=18.6
SHA256=555610c24d53e4316da5b7d3fc25c279d96856d5e0e23ee308c328c5fa881d9f
URL="https://ftp.postgresql.org/pub/source/v${VERSION}/postgresql-${VERSION}.tar.bz2"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$ROOT/.local/pg-build"
PREFIX="$ROOT/.local/pg-client-${VERSION}"
mkdir -p "$WORK"
cd "$WORK"
[ -f "postgresql-${VERSION}.tar.bz2" ] || curl -fsS -o "postgresql-${VERSION}.tar.bz2" "$URL"
echo "${SHA256}  postgresql-${VERSION}.tar.bz2" | shasum -a 256 -c -
rm -rf "src-${VERSION}" && mkdir "src-${VERSION}" && tar -xjf "postgresql-${VERSION}.tar.bz2" -C "src-${VERSION}" --strip-components=1
cd "src-${VERSION}"
./configure --prefix="$PREFIX" --without-readline --without-icu --with-zlib --without-openssl --without-ldap --without-gssapi >../configure.log 2>&1
for dir in src/include src/common src/port src/interfaces src/fe_utils; do make -j4 -C "$dir" >>../make.log 2>&1; done
for tool in pg_dump psql; do make -C "src/bin/$tool" >>../make.log 2>&1; done
make -C src/include install >../install.log 2>&1
make -C src/interfaces install >>../install.log 2>&1
for tool in pg_dump psql; do make -C "src/bin/$tool" install >>../install.log 2>&1; done
cd "$WORK" && rm -rf "src-${VERSION}"
"$PREFIX/bin/pg_restore" --version
