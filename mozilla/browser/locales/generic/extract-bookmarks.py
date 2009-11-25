import sys
import re
import codecs
try:
  from Mozilla.Parser import getParser
except ImportError:
  sys.exit('''extract-bookmarks needs compare-locales

Find that on http://pypi.python.org/pypi/compare-locales.
This script has been tested with version 0.6, and might work with future 
versions.''')

ll=re.compile('\.(title|a|dd|h[0-9])$')

p = getParser(sys.argv[1])
p.readFile(sys.argv[1])

template = '''#filter emptyLines

# LOCALIZATION NOTE: The 'en-US' strings in the URLs will be replaced with
# your locale code, and link to your translated pages as soon as they're 
# live.

#define bookmarks_title %s
#define bookmarks_heading %s

# LOCALIZATION NOTE (bookmarks_addons):
# link title for https://en-US.add-ons.mozilla.com/en-US/firefox/bookmarks/
#define bookmarks_addons %s

#define bookmarks_toolbarfolder %s
#define bookmarks_toolbarfolder_description %s

# LOCALIZATION NOTE (getting_started):
# link title for http://www.mozilla.com/en-US/firefox/central/
#define getting_started %s

# LOCALIZATION NOTE (latest_headlines):
# link title for the live bookmarks sample, a redirect on
# http://fxfeeds.mozilla.com/en-US/firefox/headlines.xml
# Changing the redirect is subject to approval of l10n-drivers.
#define latest_headlines %s

# LOCALIZATION NOTE (firefox_heading):
# Firefox links folder name
#define firefox_heading %s

# LOCALIZATION NOTE (firefox_help):
# link title for http://www.mozilla.com/en-US/firefox/help/
#define firefox_help %s

# LOCALIZATION NOTE (firefox_customize):
# link title for http://www.mozilla.com/en-US/firefox/customize/
#define firefox_customize %s

# LOCALIZATION NOTE (firefox_community):
# link title for http://www.mozilla.com/en-US/firefox/community/
#define firefox_community %s

# LOCALIZATION NOTE (firefox_about):
# link title for http://www.mozilla.com/en-US/firefox/about/
#define firefox_about %s

#unfilter emptyLines'''

strings = tuple(e.val for e in p if ll.search(e.key))

print codecs.utf_8_encode(template % strings)[0]
