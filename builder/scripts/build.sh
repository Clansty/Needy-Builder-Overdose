#!/usr/bin/env bash
set -x

cd /work
yay -Syu --noconfirm --nouseask

echo 'PACKAGER="Clansty <i@gao4.pw>"
COMPRESSZST=(zstd -19 -c -z -q --threads=0 -)
MAKEFLAGS="-j$(nproc)"
BUILDDIR=/tmp/makepkg' > ~/.makepkg.conf

sudo chmod 777 /work

source PKGBUILD
for pkg in ${EXTRA_DEPENDS[@]} ${makedepends[@]} ${depends[@]} ;do
  if [[ "${IGNORE_PACKAGES[@]}" =~ $pkg ]]; then
    continue
  fi
  yay -S --noconfirm --nouseask --needed --asdeps --overwrite='*' $pkg
done

makepkg -sfA --skipinteg --nodeps --nocheck || exit 1

makepkg --packagelist > pkgfiles
