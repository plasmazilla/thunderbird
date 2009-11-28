# -*- mode: makefile; coding: utf-8 -*-

# Copyright (c) 2009 Guido Guenther <agx@sigxcpu.org>
# Description: Project Icedove 3.0
#
# This program is free software; you can redistribute it and/or
# modify it under the terms of the GNU General Public License as
# published by the Free Software Foundation; either version 2, or (at
# your option) any later version.
#
# This program is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
# General Public License for more details.
#
# You should have received a copy of the GNU General Public License along
# with this program; if not, write to the Free Software Foundation, Inc.,
# 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA.

BRANDING_DIR = mail/branding/icedove/

MOZCLIENT_PROJECTNAME := icedove-3.0
include debian/mozclient/thunderbird-3.0.mk

post-patches:: debian/stamp-icedove-branding
debian/stamp-icedove-branding:
	cp -af debian/icedove-branding $(BRANDING_DIR)
	for uue in `find $(BRANDING_DIR) -name '*.uu'`; do \
		uudecode $$uue; rm $$uue; \
	done
	uudecode debian/preview.png.uu
	touch $@

