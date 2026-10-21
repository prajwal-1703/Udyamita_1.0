#!/usr/bin/env bash
# Downloads the open-access PDFs cited in the BlockSource paper into ./references/
# Paywalled items (ACM/IEEE/Elsevier without an OA copy) are listed at the end with their DOI.
set -u
mkdir -p references
get() { # key url
  if [ -s "references/$1.pdf" ]; then echo "skip $1"; return; fi
  curl -fsSL -A "Mozilla/5.0 (reference fetch)" -o "references/$1.pdf" "$2" && echo "ok   $1" || { echo "FAIL $1  $2"; rm -f "references/$1.pdf"; }
  sleep 3   # be polite to arXiv
}
get nakamoto2008        https://bitcoin.org/bitcoin.pdf
get wood2014yellow      https://ethereum.github.io/yellowpaper/paper.pdf
get nagle2022census     "https://www.linuxfoundation.org/hubfs/Research%20Reports/lfr_harvard_censusII_mar2022_042824b.pdf"
get durumeric2014       https://faculty.cc.gatech.edu/~mbailey/publications/imc14-heartbleed.pdf
get hiesgen2022log4j    https://arxiv.org/pdf/2205.02544
get overney2020         https://par.nsf.gov/servlets/purl/10180339
get shimada2022         https://arxiv.org/pdf/2202.05751
get zhou2021bounty      https://arxiv.org/pdf/1904.02724
get zhauniarovich2019   https://arxiv.org/pdf/1907.04002
get buterin2019qf       https://arxiv.org/pdf/1809.06421
get silva2020gsoc       https://par.nsf.gov/servlets/purl/10228575
get moldon2021          https://arxiv.org/pdf/2006.02371
get anderson2013badges  https://archives.iw3c2.org/www2013/proceedings/p95.pdf
get atzei2017           https://eprint.iacr.org/2016/1007.pdf
get luu2016             https://eprint.iacr.org/2016/633.pdf
get chen2017gas         https://arxiv.org/pdf/1703.03994
get disorbo2022gas      https://arxiv.org/pdf/2008.05449
get albert2020gasol     https://arxiv.org/pdf/1912.11929
get siddarth2020        https://arxiv.org/pdf/2008.05300
get zhang2016towncrier  https://eprint.iacr.org/2016/168.pdf
get kalodner2018arb     https://www.usenix.org/system/files/conference/usenixsecurity18/sec18-kalodner.pdf
get benet2014ipfs       https://arxiv.org/pdf/1407.3561
get buterin2020gasper   https://arxiv.org/pdf/2003.03052
get cong2021tokenomics  https://www.nber.org/system/files/working_papers/w27222/w27222.pdf
get caldarelli2020      https://www.mdpi.com/2078-2489/11/11/509/pdf
get hassan2021dao       https://policyreview.info/pdf/policyreview-2021-2-1556.pdf
cat <<'EOF'

Not downloaded automatically (no stable open-access URL; fetch via your library):
  hoffmann2024value   SSRN 4693148 (HBS WP 24-038)
  weyl2022soul        SSRN 4105763
  eghbal2016roads     Ford Foundation report (fordfoundation.org)
  lerner2002simple    doi:10.1111/1467-6451.00174
  raman2020burnout    doi:10.1145/3377816.3381732
  miller2019flossing  doi:10.1007/978-3-030-20883-7_11
  steinmacher2015     doi:10.1016/j.infsof.2014.11.001
  deterding2011       doi:10.1145/2181037.2181040
  hamari2014          doi:10.1109/HICSS.2014.377
  pedreira2015        doi:10.1016/j.infsof.2014.08.007
  mamykina2011        doi:10.1145/1978942.1979366
  douceur2002sybil    doi:10.1007/3-540-45748-8_24
  wang2019dao         doi:10.1109/TCSS.2019.2938190
  gousios2014pull     doi:10.1145/2568225.2568260
  kalliamvakou2014    doi:10.1145/2597073.2597074
  dabbish2012         doi:10.1145/2145204.2145396
  bacchelli2013       doi:10.1109/ICSE.2013.6606617
  mockus2002          doi:10.1145/567793.567795
  strathern1997       European Review 5(3):305-321, 1997
  thibault2022rollups doi:10.1109/ACCESS.2022.3200051 (open access)
  woehrer2018         doi:10.1109/IWBOSE.2018.8327565
EOF
