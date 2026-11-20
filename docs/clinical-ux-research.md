# Clinical record-review UX research

Reviewed 20 November 2026. This is a source-based design review for this assessment, not a clinician usability study or a claim of clinical validation. The application searches synthetic records across patients; that differs from searching an already-open patient chart.

## What established workflows actually do

| Primary source | Observed workflow or guidance | Application decision (our inference) |
| --- | --- | --- |
| [Methodist Le Bonheur Epic nurse training, pp. 18-19](https://www.methodistmd.org/files/epic/Day-in-the-Life/Acute-Nursing-Support-Staff/Inpatient_Nurse_Top_Efficiency.pdf) | Chart Search organizes results by date, offers type filters and previews, opens a full report from a result, and can keep search results visible in a sidebar while charting. | Keep compact results next to the selected source document. Preserve the search and result position during review. Show a clear selected row. Keep relevance ordering for this assessment, with dates visible; do not silently imply date ordering. |
| [Johns Hopkins Medicine Epic trainer guidance](https://www.hopkinsmedicine.org/news/articles/2019/08/epic-shortcuts-experts-share-their-favorite-tips) | Clinicians narrow notes/encounters with Chart Review filters. Chart Search has a keyboard shortcut. The guidance reminds users to verify the correct patient before documentation. | Keep search and filters together, make the workflow keyboard-operable, and place patient identifiers in the reader rather than burying them in an extra click. |
| [Oracle Health EHR User Guide, May 2026, chapter 9 and chapter 20](https://docs.oracle.com/en/industries/health/oracle-health-ehr/ehrfg/oracle-health-ehr-user-guide.pdf) | Documents can be filtered and grouped; the ungrouped document list is newest-first. A static patient panel carries demographics and encounter context. | Use a stable patient banner and a dated source list. Display only supplied demographics and encounter facts. Do not add empty medications, appointments, or allergy modules. |
| [Oracle Health EHR User Guide, chapter 3, Summaries](https://docs.oracle.com/en/industries/health/oracle-health-ehr/ehrfg/oracle-health-ehr-user-guide.pdf) | Generated summaries include links to their source information. Patient summaries and other summaries have workflow-specific purposes. | Keep the full source accessible from every supported summary citation. Distinguish a patient-history summary from a matched document and from the current date-filtered search. |
| [Oracle laboratory-results workflow](https://docs.oracle.com/en/industries/health/oracle-health-ehr/ehrug/view-laboratory-results.html) | Users filter for laboratory results, select an item, then inspect details. Trends are unavailable for results with incompatible/missing units or unsupported values. | Show values, units, supplied reference ranges, and supplied flags in a compact table. Do not draw trends from the current dataset, which has no validated longitudinal series. |
| [athenahealth athenaOne service description, patient-chart and results workflows](https://www.athenahealth.com/sites/default/files/media_docs/athenaOne-Service-Description.pdf) | Chart review includes a patient snapshot, histories, document search/viewing, and lab/imaging results. | Anchor document review in patient context. This assessment implements a limited document-review tool, not the full athenaOne clinical workflow. |

These sources support workflow patterns, not a claim that a particular vendor is the best or that one screen is a pixel-accurate vendor reproduction. Hospital Epic training describes that institution's configuration and publication period. Oracle's [2026 Clinical Suite playbook](https://www.oracle.com/webfolder/community/oraclehealth/roadmaps/2898234565_Clinical%20Suite.pdf) contains illustrative chart-review views but explicitly qualifies feature availability; screenshots alone are not proof of a released workflow.

## Patient context is a safety requirement

[NISTIR 7804-1, section 6, pp. 36-37](https://nvlpubs.nist.gov/nistpubs/ir/2015/NIST.IR.7804-1.pdf) recommends a reserved, consistently located patient-identification region that stays visible through scrolling/navigation. Its guidance also addresses predictable information placement and clearly organized lists. Apply this as a fixed patient banner over the reader, not as a marketing sidebar.

The [SAFER Patient Identification guide, practices 1.2-1.3, pp. 11-12](https://healthit.gov/wp-content/uploads/2025/01/Safer-Guide-6.-Patient-Identification-Final.pdf) recommends multiple identifiers in patient lists, clear selection highlighting, and readable identification with little clutter. The reader should show the supplied full name, DOB and MRN together. A cross-patient result must clearly identify its owner; switching results must not display a previous patient's content under a new patient's banner.

The schema supplies a full-name string and a gender field. Preserve those values: do not infer family-name components, legal sex, gender identity, missing demographics, allergies, diagnoses, or vital signs. An absent value is unknown, not a normal/negative clinical finding.

## Concrete redesign

- Replace the wide navigation area, slogans, promotional cards, and permanent instruction panel with a compact application header and search/filter toolbar.
- On desktop, keep a scannable result list beside a source reader. Reserve the reader's upper section for patient identity. Put document date, category, title and provenance near the document.
- Prioritize the original source when selecting a document match. Offer a separate patient-summary view, with dated source links and an explicit history scope. An unavailable or stale summary must not block document reading.
- Keep similarity as neutral search metadata. It is not a probability, medical severity, or clinical confidence score. Do not color a result green as if it were a normal finding.
- Retain clear date/type filters and a visible selected result. On narrow screens, use one focused review surface with a clear return to results and restored focus.
- Keep examples and instructions brief and available on demand; they should not compete with clinical content.

## Verification targets

[WCAG 2.2 contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) requires 4.5:1 for ordinary text and 3:1 for large text, subject to its stated exceptions. [Keyboard guidance](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html) and [visible-focus guidance](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html) require usable keyboard interaction and visible focus. Test those properties, not just screenshots.

Verify: query/filter/result consistency; patient ownership on rapid selection changes; persistent identity while scrolling; source citation navigation; unknown and stale states; date-range semantics; long multilingual names; desktop/short-window/mobile layouts; keyboard focus/return; and contrast. Browser tests cannot establish clinician efficiency or safe real-world use. Those claims would require representative clinicians and measured review tasks.
