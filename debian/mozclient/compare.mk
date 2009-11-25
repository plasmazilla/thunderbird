# -*- mode: makefile; coding: utf-8 -*-

# Copyright (c) 2007-2008 Fabien Tassin <fta@sofaraway.org>
# Description: The 'compare' module of mozilla-devscripts
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

#####################################################################

# Don't include this file directly, include one of the project.mk
# file instead, which will include this file for you.

# The following target is available to the caller:
# compare: check the difference between:
# a/ what has been built (in dists/bin) and what has been installed (in debian/tmp)
# b/ what has been installed (in debian/tmp) and what has been put in the debs
# dists/bin is populated by the upstream build system
# debian/tmp is populated according to upstream installer/package-static files
#
# The following variable are available:
# COMPARE_FILTER_PRE_IN and COMPARE_FILTER_PRE_OUT (for a/)
# COMPARE_FILTER_IN and COMPARE_FILTER_OUT (for b/)
# By default, all are 'sed' commands that could be augmented (+=) or
# overwritten by the caller.

TEMP           := $(shell echo $$$$)
LIST_BUILT     := /tmp/built.$(TEMP)
LIST_INSTALLED := /tmp/installed.$(TEMP)
LIST_IN_DEBS   := /tmp/in_debs.$(TEMP)

PKG_DIRS = $(addprefix debian/,$(shell grep ^Package debian/control | cut -d' ' -f2))

compare:
	@if [ "Z${COMPARE_FILTER_PRE_IN}Z" = "ZZ" ] ; then \
	echo "## Can't compare dist/bin and debian/tmp (no COMPARE_FILTER_PRE_IN filter defined)" ; \
	else \
	if [ -d mozilla/dist ] ; then \
	find mozilla/dist/bin \! -type d | cut -d/ -f4- | $(COMPARE_FILTER_PRE_IN) | sort > $(LIST_BUILT) ; \
	elif [ -d build-tree/mozilla/dist ] ; then \
	find build-tree/mozilla/dist/bin \! -type d | cut -d/ -f5- | $(COMPARE_FILTER_PRE_IN) | sort > $(LIST_BUILT) ; \
	elif [ -d build-tree/dist ] ; then \
	find build-tree/dist/bin \! -type d | cut -d/ -f4- | $(COMPARE_FILTER_PRE_IN) | sort > $(LIST_BUILT) ; \
	elif [ -d dist ] ; then \
	find dist/bin \! -type d | cut -d/ -f3- | $(COMPARE_FILTER_PRE_IN) | sort > $(LIST_BUILT) ; \
	elif [ -d $(DEB_BUILDDIR)/mozilla/dist ] ; then \
	find $(DEB_BUILDDIR)/mozilla/dist/bin \! -type d | sed -e 's,.*mozilla/dist/bin/,,' | $(COMPARE_FILTER_PRE_IN) | sort > $(LIST_BUILT) ; \
	else \
	echo "Error: Can't find any suitable dist/bin directory" ; \
	fi ; \
	find debian/tmp -type f | cut -d/ -f3- | $(COMPARE_FILTER_PRE_OUT) | sort > $(LIST_INSTALLED) ; \
	echo "## Compare the content of dist/bin and debian/tmp..." ; \
	diff -u $(LIST_BUILT) $(LIST_INSTALLED)  | grep -E '^(\+|-).' | tail -n +3 ;\
	echo "## =================================================" ; \
	fi
	@if [ "Z${COMPARE_FILTER_IN}Z" = "ZZ" ] ; then \
	echo "## Can't compare debian/tmp and the debs produced (no COMPARE_FILTER_IN filter defined)" ; \
	else \
	echo "## Compare the content of debian/tmp and the debs produced..." ; \
	find debian/tmp -type f | cut -d/ -f3- | $(COMPARE_FILTER_IN) | sort > $(LIST_INSTALLED) ; \
	find $(PKG_DIRS) -type f | cut -d/ -f3- | $(COMPARE_FILTER_OUT) | sort > $(LIST_IN_DEBS) ; \
	diff -u $(LIST_INSTALLED) $(LIST_IN_DEBS) | grep -E '^(\+|-).' | tail -n +3 ; \
	fi
	@echo "## End of Compare"
	@rm -f $(LIST_BUILT) $(LIST_INSTALLED) $(LIST_IN_DEBS)
