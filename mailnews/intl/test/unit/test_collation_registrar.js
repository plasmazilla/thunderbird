const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cm = Components.manager;

function checkRegistrar()
{
  var localeService = Cc["@mozilla.org/intl/nslocaleservice;1"].
    getService(Ci.nsILocaleService);
  var systemLocale = localeService.getSystemLocale();

  var localeSvc = Cc["@mozilla.org/intl/nslocaleservice;1"].
    getService(Ci.nsILocaleService);
  var collator = Cc["@mozilla.org/intl/collation-factory;1"].
    createInstance(Ci.nsICollationFactory).
    CreateCollation(localeSvc.newLocale("ja-JP"));
  var strength = Ci.nsICollation.kCollationStrengthDefault;

  /* nsICollation uses ICU only if System locale starts with "ja".
   * U+3042 < than U+0410 on ICU
   * U+3042 > than U+0410 on CoreServices */
  do_check_eq(collator.compareString(strength, "\u3042", "\u0410") < 0,
              systemLocale.getCategory("NSILOCALE_COLLATE").startsWith("ja"));
}

function run_test()
{
  checkRegistrar();
}
