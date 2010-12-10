/* -*- Mode: C++; tab-width: 20; indent-tabs-mode: nil; c-basic-offset: 4 -*-
 * ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is thebes gfx code.
 *
 * The Initial Developer of the Original Code is Mozilla Corporation.
 * Portions created by the Initial Developer are Copyright (C) 2008
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   John Daggett <jdaggett@mozilla.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

#ifdef MOZ_LOGGING
#define FORCE_PR_LOG /* Allow logging in the release build */
#endif /* MOZ_LOGGING */
#include "prlog.h"

#include "gfxUserFontSet.h"
#include "gfxPlatform.h"
#include "nsReadableUtils.h"
#include "nsUnicharUtils.h"
#include "nsVoidArray.h"
#include "prlong.h"

#include "ots/opentype-sanitiser.h"
#include "ots/ots-memory-stream.h"

#ifdef PR_LOGGING
static PRLogModuleInfo *gUserFontsLog = PR_NewLogModule("userfonts");
#endif /* PR_LOGGING */

#define LOG(args) PR_LOG(gUserFontsLog, PR_LOG_DEBUG, args)
#define LOG_ENABLED() PR_LOG_TEST(gUserFontsLog, PR_LOG_DEBUG)

static PRUint64 sFontSetGeneration = LL_INIT(0, 0);

// TODO: support for unicode ranges not yet implemented

gfxProxyFontEntry::gfxProxyFontEntry(const nsTArray<gfxFontFaceSrc>& aFontFaceSrcList, 
             gfxMixedFontFamily *aFamily,
             PRUint32 aWeight, 
             PRUint32 aStretch, 
             PRUint32 aItalicStyle, 
             gfxSparseBitSet *aUnicodeRanges)
    : gfxFontEntry(NS_LITERAL_STRING("Proxy")), mIsLoading(PR_FALSE),
      mFamily(aFamily)
{
    mIsProxy = PR_TRUE;
    mSrcList = aFontFaceSrcList;
    mSrcIndex = 0;
    mWeight = aWeight;
    mStretch = aStretch;
    mItalic = (aItalicStyle & (FONT_STYLE_ITALIC | FONT_STYLE_OBLIQUE)) != 0;
}

gfxProxyFontEntry::~gfxProxyFontEntry()
{

}


PRBool
gfxMixedFontFamily::FindWeightsForStyle(gfxFontEntry* aFontsForWeights[], 
                                        const gfxFontStyle& aFontStyle)
{
    PRBool italic = (aFontStyle.style & (FONT_STYLE_ITALIC | FONT_STYLE_OBLIQUE)) != 0;
    PRBool matchesSomething;

    for (PRUint32 j = 0; j < 2; j++) {
        matchesSomething = PR_FALSE;
        PRUint32 numFonts = mAvailableFonts.Length();
        // build up an array of weights that match the italicness we're looking for
        for (PRUint32 i = 0; i < numFonts; i++) {
            gfxFontEntry *fe = mAvailableFonts[i];
            PRUint32 weight = fe->mWeight/100;
            if (fe->mItalic == italic) {
                aFontsForWeights[weight] = fe;
                matchesSomething = PR_TRUE;
            }
        }
        if (matchesSomething)
            break;
        italic = !italic;
    }

    return matchesSomething;
}


gfxUserFontSet::gfxUserFontSet()
{
    mFontFamilies.Init(5);
    IncrementGeneration();
}

gfxUserFontSet::~gfxUserFontSet()
{

}

void
gfxUserFontSet::AddFontFace(const nsAString& aFamilyName, 
                            const nsTArray<gfxFontFaceSrc>& aFontFaceSrcList, 
                            PRUint32 aWeight, 
                            PRUint32 aStretch, 
                            PRUint32 aItalicStyle, 
                            gfxSparseBitSet *aUnicodeRanges)
{
    nsAutoString key(aFamilyName);
    ToLowerCase(key);

    PRBool found;

    if (aWeight == 0)
        aWeight = FONT_WEIGHT_NORMAL;

    // stretch, italic/oblique ==> zero implies normal

    gfxMixedFontFamily *family = mFontFamilies.GetWeak(key, &found);
    if (!family) {
        family = new gfxMixedFontFamily(aFamilyName);
        mFontFamilies.Put(key, family);
    }

    // construct a new face and add it into the family
    if (family) {
        gfxProxyFontEntry *proxyEntry = 
            new gfxProxyFontEntry(aFontFaceSrcList, family, aWeight, aStretch, 
                                  aItalicStyle, aUnicodeRanges);
        family->AddFontEntry(proxyEntry);
#ifdef PR_LOGGING
        if (LOG_ENABLED()) {
            LOG(("userfonts (%p) added (%s) with style: %s weight: %d stretch: %d", 
                 this, NS_ConvertUTF16toUTF8(aFamilyName).get(), 
                 (aItalicStyle & FONT_STYLE_ITALIC ? "italic" : 
                     (aItalicStyle & FONT_STYLE_OBLIQUE ? "oblique" : "normal")), 
                 aWeight, aStretch));
        }
#endif
    }
}

gfxFontEntry*
gfxUserFontSet::FindFontEntry(const nsAString& aName, 
                              const gfxFontStyle& aFontStyle, 
                              PRBool& aNeedsBold)
{
    gfxMixedFontFamily *family = GetFamily(aName);

    // no user font defined for this name
    if (!family)
        return nsnull;

    gfxFontEntry* fe = family->FindFontForStyle(aFontStyle, aNeedsBold);

    // if not a proxy, font has already been loaded
    if (!fe->mIsProxy)
        return fe;

    gfxProxyFontEntry *proxyEntry = static_cast<gfxProxyFontEntry*> (fe);

    // if currently loading, return null for now
    if (proxyEntry->mIsLoading)
        return nsnull;

    // hasn't been loaded yet, start the load process
    LoadStatus status;

    status = LoadNext(proxyEntry);

    // if the load succeeded immediately, the font entry was replaced so
    // search again
    if (status == STATUS_LOADED)
        return family->FindFontForStyle(aFontStyle, aNeedsBold);

    // if either loading or an error occurred, return null
    return nsnull;
}

// Based on ots::ExpandingMemoryStream from ots-memory-stream.h,
// adapted to use Mozilla allocators and to allow the final
// memory buffer to be adopted by the client.
class ExpandingMemoryStream : public ots::OTSStream {
public:
    ExpandingMemoryStream(size_t initial, size_t limit)
        : mLength(initial), mLimit(limit), mOff(0) {
        mPtr = NS_Alloc(mLength);
    }

    ~ExpandingMemoryStream() {
        NS_Free(mPtr);
    }

    // return the buffer, and give up ownership of it
    // so the caller becomes responsible to call NS_Free
    // when finished with it
    void* forget() {
        void* p = mPtr;
        mPtr = nsnull;
        return p;
    }

    bool WriteRaw(const void *data, size_t length) {
        if ((mOff + length > mLength) ||
            (mLength > std::numeric_limits<size_t>::max() - mOff)) {
            if (mLength == mLimit) {
                return false;
            }
            size_t newLength = (mLength + 1) * 2;
            if (newLength < mLength) {
                return false;
            }
            if (newLength > mLimit) {
                newLength = mLimit;
            }
            mPtr = NS_Realloc(mPtr, newLength);
            mLength = newLength;
            return WriteRaw(data, length);
        }
        std::memcpy(static_cast<char*>(mPtr) + mOff, data, length);
        mOff += length;
        return true;
    }

    bool Seek(off_t position) {
        if (position < 0) {
            return false;
        }
        if (static_cast<size_t>(position) > mLength) {
            return false;
        }
        mOff = position;
        return true;
    }

    off_t Tell() const {
        return mOff;
    }

private:
    void*        mPtr;
    size_t       mLength;
    const size_t mLimit;
    off_t        mOff;
};

// Call the OTS library to sanitize an sfnt before attempting to use it.
// Returns a newly-allocated block, or NULL in case of fatal errors.
static const PRUint8*
SanitizeOpenTypeData(const PRUint8* aData, PRUint32 aLength,
                     PRUint32& aSaneLength, bool aIsCompressed)
{
    // limit output/expansion to 256MB
    ExpandingMemoryStream output(aIsCompressed ? aLength * 2 : aLength,
                                 1024 * 1024 * 256);
    if (ots::Process(&output, aData, aLength,
        gfxPlatform::GetPlatform()->PreserveOTLTablesWhenSanitizing())) {
        aSaneLength = output.Tell();
        return static_cast<PRUint8*>(output.forget());
    } else {
        aSaneLength = 0;
        return nsnull;
    }
}

PRBool 
gfxUserFontSet::OnLoadComplete(gfxFontEntry *aFontToLoad,
                               const PRUint8 *aFontData, PRUint32 aLength, 
                               nsresult aDownloadStatus)
{
    NS_ASSERTION(aFontToLoad->mIsProxy, "trying to load font data for wrong font entry type");

    if (!aFontToLoad->mIsProxy)
        return PR_FALSE;

    gfxProxyFontEntry *pe = static_cast<gfxProxyFontEntry*> (aFontToLoad);

    // download successful, make platform font using font data
    if (NS_SUCCEEDED(aDownloadStatus)) {
        gfxFontEntry *fe = nsnull;

        if (gfxPlatform::GetPlatform()->SanitizeDownloadedFonts()) {
            // Call the OTS sanitizer.
            // The original data in aFontData is left unchanged.
            PRUint32 saneLen;
            const PRUint8* saneData =
                SanitizeOpenTypeData(aFontData, aLength, saneLen, PR_FALSE);
            NS_Free((void*)aFontData);
            aFontData = nsnull;
#ifdef DEBUG
            if (!saneData) {
                char buf[1000];
                sprintf(buf, "downloaded font rejected for \"%s\"",
                        NS_ConvertUTF16toUTF8(pe->mFamily->Name()).get());
                NS_WARNING(buf);
            }
#endif
            if (saneData) {
                // Here ownership of saneData is passed to the platform,
                // which will delete it when no longer required
                fe = gfxPlatform::GetPlatform()->MakePlatformFont(pe,
                                                                  saneData,
                                                                  saneLen);
                if (!fe) {
                    NS_WARNING("failed to make platform font from download");
                }
            }
        } else {
            // FIXME: this code can be removed if we remove the pref to
            // disable the sanitizer; ValidateSFNTHeaders will then be obsolete.
            if (gfxFontUtils::ValidateSFNTHeaders(aFontData, aLength)) {
                // Here ownership of aFontData is passed to the platform,
                // which will delete it when no longer required
                fe = gfxPlatform::GetPlatform()->MakePlatformFont(pe,
                                                                  aFontData,
                                                                  aLength);
                aFontData = nsnull; // we must NOT free this below!
                if (!fe) {
                    NS_WARNING("failed to make platform font from download");
                }
            }
        }
        if (fe) {
            static_cast<gfxMixedFontFamily*>(pe->mFamily)->ReplaceFontEntry(pe, fe);
            IncrementGeneration();
#ifdef PR_LOGGING
            if (LOG_ENABLED()) {
                nsCAutoString fontURI;
                pe->mSrcList[pe->mSrcIndex].mURI->GetSpec(fontURI);
                LOG(("userfonts (%p) [src %d] loaded uri: (%s) for (%s) gen: %8.8x\n",
                     this, pe->mSrcIndex, fontURI.get(),
                     NS_ConvertUTF16toUTF8(pe->mFamily->Name()).get(),
                     PRUint32(mGeneration)));
            }
#endif
            return PR_TRUE;
        }
    } else {
        // download failed
#ifdef PR_LOGGING
        if (LOG_ENABLED()) {
            nsCAutoString fontURI;
            pe->mSrcList[pe->mSrcIndex].mURI->GetSpec(fontURI);
            LOG(("userfonts (%p) [src %d] failed uri: (%s) for (%s) error %8.8x downloading font data\n", 
                 this, pe->mSrcIndex, fontURI.get(), 
                 NS_ConvertUTF16toUTF8(pe->mFamily->Name()).get(), 
                 aDownloadStatus));
        }
#endif
    }

    if (aFontData) {
        NS_Free((void*)aFontData);
        aFontData = nsnull;
    }

    // error occurred, load next src
    LoadStatus status;

    status = LoadNext(pe);
    if (status == STATUS_LOADED) {
        // load may succeed if external font resource followed by
        // local font, in this case need to bump generation
        IncrementGeneration();
        return PR_TRUE;
    }

    return PR_FALSE;
}


gfxUserFontSet::LoadStatus
gfxUserFontSet::LoadNext(gfxProxyFontEntry *aProxyEntry)
{
    PRUint32 numSrc = aProxyEntry->mSrcList.Length();

    NS_ASSERTION(aProxyEntry->mSrcIndex < numSrc, "already at the end of the src list for user font");

    if (aProxyEntry->mIsLoading) {
        aProxyEntry->mSrcIndex++;
    } else {
        aProxyEntry->mIsLoading = PR_TRUE;
    }

    // load each src entry in turn, until a local face is found or a download begins successfully
    while (aProxyEntry->mSrcIndex < numSrc) {
        const gfxFontFaceSrc& currSrc = aProxyEntry->mSrcList[aProxyEntry->mSrcIndex];

        // src local ==> lookup and load   

        if (currSrc.mIsLocal) {
            gfxFontEntry *fe =
                gfxPlatform::GetPlatform()->LookupLocalFont(aProxyEntry,
                                                            currSrc.mLocalName);
            if (fe) {
                LOG(("userfonts (%p) [src %d] loaded local: (%s) for (%s) gen: %8.8x\n", 
                     this, aProxyEntry->mSrcIndex, 
                     NS_ConvertUTF16toUTF8(currSrc.mLocalName).get(), 
                     NS_ConvertUTF16toUTF8(aProxyEntry->mFamily->Name()).get(), 
                     PRUint32(mGeneration)));
                aProxyEntry->mFamily->ReplaceFontEntry(aProxyEntry, fe);
                return STATUS_LOADED;
            } else {
                LOG(("userfonts (%p) [src %d] failed local: (%s) for (%s)\n", 
                     this, aProxyEntry->mSrcIndex, 
                     NS_ConvertUTF16toUTF8(currSrc.mLocalName).get(), 
                     NS_ConvertUTF16toUTF8(aProxyEntry->mFamily->Name()).get()));            
            }
        } 

        // src url ==> start the load process
        else {
            if (gfxPlatform::GetPlatform()->IsFontFormatSupported(currSrc.mURI, 
                    currSrc.mFormatFlags)) {
                nsresult rv = StartLoad(aProxyEntry, &currSrc);
                PRBool loadOK = NS_SUCCEEDED(rv);
                
                if (loadOK) {
#ifdef PR_LOGGING
                    if (LOG_ENABLED()) {
                        nsCAutoString fontURI;
                        currSrc.mURI->GetSpec(fontURI);
                        LOG(("userfonts (%p) [src %d] loading uri: (%s) for (%s)\n", 
                             this, aProxyEntry->mSrcIndex, fontURI.get(), 
                             NS_ConvertUTF16toUTF8(aProxyEntry->mFamily->Name()).get()));
                    }
#endif
                    return STATUS_LOADING;                  
                } else {
#ifdef PR_LOGGING
                    if (LOG_ENABLED()) {
                        nsCAutoString fontURI;
                        currSrc.mURI->GetSpec(fontURI);
                        LOG(("userfonts (%p) [src %d] failed uri: (%s) for (%s) download failed\n", 
                             this, aProxyEntry->mSrcIndex, fontURI.get(), 
                             NS_ConvertUTF16toUTF8(aProxyEntry->mFamily->Name()).get()));
                    }
#endif
                }
            } else {
#ifdef PR_LOGGING
                if (LOG_ENABLED()) {
                    nsCAutoString fontURI;
                    currSrc.mURI->GetSpec(fontURI);
                    LOG(("userfonts (%p) [src %d] failed uri: (%s) for (%s) format not supported\n", 
                         this, aProxyEntry->mSrcIndex, fontURI.get(), 
                         NS_ConvertUTF16toUTF8(aProxyEntry->mFamily->Name()).get()));
                }
#endif
            }
        }

        aProxyEntry->mSrcIndex++;
    }

    // all src's failed, remove this face
    LOG(("userfonts (%p) failed all src for (%s)\n", 
               this, NS_ConvertUTF16toUTF8(aProxyEntry->mFamily->Name()).get()));            

    gfxMixedFontFamily *family = aProxyEntry->mFamily;

    aProxyEntry->mFamily->RemoveFontEntry(aProxyEntry);

    // no more faces?  remove the entire family
    if (family->mAvailableFonts.Length() == 0) {
        LOG(("userfonts (%p) failed all faces, remove family (%s)\n", 
             this, NS_ConvertUTF16toUTF8(family->Name()).get()));            
        RemoveFamily(family->Name());
    }

    return STATUS_END_OF_LIST;
}


void
gfxUserFontSet::IncrementGeneration()
{
    // add one, increment again if zero
    LL_ADD(sFontSetGeneration, sFontSetGeneration, 1);
    if (LL_IS_ZERO(sFontSetGeneration))
        LL_ADD(sFontSetGeneration, sFontSetGeneration, 1);
    mGeneration = sFontSetGeneration;
}


gfxMixedFontFamily*
gfxUserFontSet::GetFamily(const nsAString& aFamilyName) const
{
    nsAutoString key(aFamilyName);
    ToLowerCase(key);

    return mFontFamilies.GetWeak(key);
}


void 
gfxUserFontSet::RemoveFamily(const nsAString& aFamilyName)
{
    nsAutoString key(aFamilyName);
    ToLowerCase(key);

    mFontFamilies.Remove(key);
}
