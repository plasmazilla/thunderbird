# This Source Code Form is subject to the terms of the Mozilla Public
# # License, v. 2.0. If a copy of the MPL was not distributed with this
# # file, You can obtain one at http://mozilla.org/MPL/2.0/.

# NSIS defines for nightly builds.
# The release build branding.nsi is located in other-license/branding/thunderbird/
!define BrandShortName        "Icedove"

# BrandFullNameInternal is used for some registry and file system values
# instead of BrandFullName and typically should not be modified.
!define BrandFullNameInternal "Icedove Mail/News"
!define CompanyName           "debian.org"
!define URLInfoAbout          "http://www.mozilla.org/"
!define URLUpdateInfo         "http://www.mozilla.org/products/thunderbird/"
!define SurveyURL             "https://survey.mozilla.com/1/Mozilla%20Thunderbird/${AppVersion}/${AB_CD}/exit.html"

# Everything below this line may be modified for Alpha / Beta releases.
!define BrandFullName         "Icedove"

# Add !define NO_INSTDIR_FROM_REG to prevent finding a non-default installation
# directory in the registry and using that as the default. This prevents
# Beta releases built with official branding from finding an existing install
# of an official release and defaulting to its installation directory.
