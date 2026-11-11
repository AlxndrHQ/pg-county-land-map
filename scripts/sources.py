"""Parcel sources beyond Prince George's County.

Each source is one ArcGIS layer (plus, where needed, a separate owner table). The jurisdiction
code prefixes every parcel id from that source (PG keeps bare ids so saved projects still work),
names the cache folder data/raw/<code>/ and the data folder web/data/<code>/.
"""

MD_IMAP = "https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0"
MD_FIELDS = [
    "OBJECTID", "JURSCODE", "ACCTID", "ADDRESS", "CITY", "ZIPCODE",
    "OWNADD1", "OWNADD2", "OWNCITY", "OWNSTATE", "OWNERZIP",
    "DR1LIBER", "DR1FOLIO", "ZONING", "CIUSE", "DESCCIUSE", "EXCLASS", "DESCEXCL", "LU", "DESCLU",
    "ACRES", "YEARBLT", "TRADATE", "CONSIDR1", "NFMLNDVL", "NFMIMPVL", "NFMTTLVL",
    "SDATWEBADR", "SDATDATE", "OOI", "RESITYP", "PTYPE", "BLDG_UNITS",
]

SOURCES = {
    "AA": {"name": "Anne Arundel County, MD", "state": "MD", "layer": MD_IMAP,
           "where": "JURSCODE='ANNE'", "fields": MD_FIELDS, "page": 1000},
    "MO": {"name": "Montgomery County, MD", "state": "MD", "layer": MD_IMAP,
           "where": "JURSCODE='MONT'", "fields": MD_FIELDS, "page": 1000},
    "CH": {"name": "Charles County, MD", "state": "MD", "layer": MD_IMAP,
           "where": "JURSCODE='CHAR'", "fields": MD_FIELDS, "page": 1000},
}
