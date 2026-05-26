# Pink Ward Project Grill Log

## **Important Note**
**Question:** What top-level platform/runtime constraints must Pink Ward satisfy across different Windows machines?

**Answer:** This program is meant to run on many different windows systems using many different monitor resolutions and user names. nothing should be hard coded and everything should be realitive to the system its on. some of the computers may not even have python installed and this app will need to run as an executable that installs at relevant dependanceis.

## 1. Project Unit
**Question:** What is the primary unit this app is organized around: a single YOLO model per project, or a project that can contain multiple models, datasets, training runs, and validation runs over time?

**Answer:** a project that can contain multiple models for sure and can be tested against eachother with metrics for each model like those little charts yolo outputs should be compareable through training iterations

## 2. Model Record
**Question:** What exactly is a “model” in your system: just a weights file like `best.pt`/`last.pt`, or a full tracked model record with its own training config, source dataset snapshot, metrics, artifacts, notes, and lineage?

**Answer:** full folders yeah with all the metrics

## 3. Comparison Scope
**Question:** When you say models should be compared “through training iterations,” do you want comparisons only within one project, or also across different projects if they share the same class set and task?

**Answer:** only inside the project

## 4. YOLO Task Scope
**Question:** What kinds of YOLO tasks must this hub support in version 1: detection only, or detection plus segmentation, classification, pose, and OBB?

**Answer:** it needs detections and classifications with labels

## 5. Correction on Task Scope
**Question:** Should detection projects and classification projects live under the same project type with shared infrastructure, or should the app treat them as two explicit project modes from the moment a project is created?

**Answer:** sorry actually just make it have detection with bounding boxes we dont need just pre calassification that is useless

## 6. V1 Project Mode
**Question:** For v1, should every project be strictly object detection with bounding boxes, with no mixed-mode support inside the same project?

**Answer:** yes

## 7. Backend
**Question:** What YOLO backend are we standardizing on for training and validation in v1: Ultralytics YOLO on local Python, or do you want the app architected to support multiple backends from day one?

**Answer:** just have ultralytics on python

## 8. Deployment Model
**Question:** Is this app meant to be fully local-first on your machine, with projects, datasets, models, and runs stored on disk and no required cloud account or server?

**Answer:** 100% local first yes

## 9. Folder Ownership
**Question:** Should Pink Ward manage a canonical project folder structure itself, so every project has predictable subfolders like `data`, `models`, `runs`, `exports`, and `metadata`, or should it mostly point at arbitrary external folders the user already has?

**Answer:** nope it should definitely be building its own folders

## 10. Workspace Root
**Question:** Where should the top-level project library live by default on disk: one global workspace root that Pink Ward manages, or should the user choose a location every time they create a project?

**Answer:** it should all be within one global workspace root that has the installation of pink ward in. and on this topic DO NOT hardcode by system address into the code at all beacuse  this has to run on many different systems. it should just reference the root of the pinkward folder

## 11. App Data Separation
**Question:** Should Pink Ward be a portable app where the app install folder itself also contains the workspace data, projects, models, and metadata relative to the Pink Ward root, or should the app binary and the workspace root be separate but linked by config?

**Answer:** question 11 do the reccomended and have data seperate and pointed at. open only projects that live in the pink ward workspace. they should be able to import stuff into the workspace though like drop in files but they must live inside the pink ward project at that point so what data was used can be tracked

## 12. Import Policy
**Question:** Do you want users to be able to open only projects that live inside the Pink Ward workspace root, or should they also be able to import outside datasets and videos into a project while Pink Ward tracks them from inside its own project metadata?

**Answer:** question 11 do the reccomended and have data seperate and pointed at. open only projects that live in the pink ward workspace. they should be able to import stuff into the workspace though like drop in files but they must live inside the pink ward project at that point so what data was used can be tracked

## 13. Import File Handling
**Question:** When data is imported into a project, should Pink Ward physically copy it into that project’s managed folders, or is moving the files acceptable?

**Answer:** copying yes

## 14. Managed Records
**Question:** After import, do you want Pink Ward to treat the copied files as immutable source records for lineage, or should users be allowed to rename, delete, or replace imported files directly inside the project data folders from within the app?

**Answer:** yes treat them as managed records but there needs to be a way for the user to delete data or model iterations without deleting the whole project. this should be super intentional tho

## 15. Data Unit
**Question:** What should count as a distinct data unit inside a project for tracking and training lineage: individual files, imported batches, or named dataset snapshots?

**Answer:** batches and individual files have a dropdown for 'batches' and 'files'

## 16. Batch Meaning
**Question:** Should a batch be just a grouping of imported files, or should it also store import-time processing decisions like source path, import date, frame extraction settings, class expectations, and who or what created it?

**Answer:** just whatever group of files was imported together. like for example when importing you should be able to drag and drop in whatever images you want into the batch and say there is like 500 images or something inside the import that will be consider one new batch for the purposes of looking through the imports.

## 17. Batch Mutation
**Question:** If a user imports 500 images as one batch, then later deletes 20 bad images from that batch, should the batch remain the same batch with a change history, or should that create a new derived batch or version?

**Answer:** yes it should reamain the same in the history

## 18. Data Deletion
**Question:** Do you want deleted data to be soft-deleted first, so it can be restored and still appear in history, or should intentional deletion remove the files immediately from the project?

**Answer:** yes it should be soft deleted and be recoverable but it should be able to have a trash bin that is emptyable

## 19. Model Deletion
**Question:** For model iterations, should deletion work the same way as data, meaning soft-delete to a recoverable trash first, or do you want stricter rules for model artifacts?

**Answer:** yes same

## 20. Model Iteration Naming
**Question:** What exactly is a model iteration in Pink Ward: every training run, or only the runs the user explicitly promotes or saves as meaningful versions?

**Answer:** every single training run should be saved and the default name should be the name of the projecdt and then v(x) liek v1, v2, v3, v4, .... unlesse the user renames it

## 21. Version Number Reuse
**Question:** Should `v1`, `v2`, `v3` be assigned across all training runs in a project globally, even if the user later soft-deletes some versions, or should deleted versions free up numbers for reuse?

**Answer:** no it should never be reused

## 22. Dataset Snapshot
**Question:** When a training run starts, should Pink Ward create a frozen dataset snapshot reference immediately so that version `v7` always knows exactly which files were included, even if the project data changes later?

**Answer:** yes for sure

## 23. Snapshot Clarification Request
**Question:** What should define that frozen training snapshot: a manifest of exact file identities included in the run, or just a reference to the active batches at the time training started?

**Answer:** define an an exact manifest before asking the next question

## 24. Deleted Tag Requirement
**Question:** After clarifying the exact manifest concept, should any file that no longer exists in the active dataset be tagged as deleted rather than disappearing from history?

**Answer:** okay yes but any file that no longer exists in the dataset should have a tag that says 'deleted' if its no longer active within the dataset

## 25. Resplit Trigger
**Question:** At training time, do you want the user to choose between reusing the existing split and generating a new split, with reuse as the default?

**Answer:** okay actually yes dont resplit by default but have a button called 'resplit' where you press it and then can resplit everything and choose the train vs test vs val percentages as well or just resplit with current settings

## 26. New Data Assignment
**Question:** When new data is imported after a split already exists, should Pink Ward automatically assign those new files into train, val, and test using the current split ratios, or should new files remain unassigned until the user explicitly runs split assignment?

**Answer:** they should be auto assigned and maintain specified balance between the sets

## 27. Split Balancing Target
**Question:** Should that auto-assignment try to maintain balance only by overall counts, or also by class distribution so rare classes do not all accidentally end up in one split?

**Answer:** yes class aware balancing for sure

## 28. Hybrid Split Logic Clarification
**Question:** For detection, how should Pink Ward determine class balance during splitting: by presence of a class in an image, by number of boxes per class, or by a hybrid approach?

**Answer:** what algo would be used to do this hybrid approach?

## 29. Deterministic Seeded Split
**Question:** Do you want Pink Ward’s splitting behavior to be deterministic, meaning the same dataset plus the same split settings always produce the same split unless the user changes a random seed?

**Answer:** yes for question 28, also when i ask a question please do not go ahead and ask the nexst question until i say yes or no to the previous question i was clarifying. now the answer to 29, yes do a seeded split in that split menu we were talking about earlier under the split tab. above resplit and resplit with new assignemnts it should say 'current seed'

## 30. Default Split Ratios
**Question:** Do you want test enabled by default in every project, or should v1 default to just train plus val and let test be optional?

**Answer:** test should be enabled in every dataset. the balance should immedaitely come up when making a new project and be alterable but the default values should appear as 80% train, 15% val and 5% test

## 31. Split Settings Scope
**Question:** Should those default split ratios be stored at the project level and apply to all future imports and resplits unless changed, or should each resplit dialog start fresh and not update the project’s default behavior?

**Answer:** yes at the project level

## 32. Segment Modeling
**Question:** Should detection segments for video be represented as one time span with class details inside it, rather than as separate overlapping segments per class?

**Answer:** sure yes do it that way

## 33. Internal Merge Heuristic
**Question:** Should Pink Ward automatically infer video merge behavior from the video timing and inference cadence, with no user control in v1?

**Answer:** sure

## 34. Inference Frequency UX
**Question:** For video validation, should the user control inference cadence through an inference frequency setting rather than frame-based language?

**Answer:** sure but it shouldnt ask them in frames it should be lie infrence frequency when they click on the infrenece button whatever it is gonna be named and it should explain like more infrence = more resources computationally less infrence = easier to run less accurate.

## 35. Preset Names
**Question:** Should that inference frequency be expressed with presets like High accuracy, Balanced, and Fast scan?

**Answer:** yes high accuracy balanced and fast scan

## 36. Adaptive Presets
**Question:** Should Pink Ward adapt those presets based on video FPS and duration so Balanced feels similar across different media?

**Answer:** adapt

## 37. Test Rendering Policy
**Question:** Do you still want every project to always keep a dedicated test split for final untouched evaluation, and should rendered outputs come from the test set rather than the validation set?

**Answer:** yes keep but also generate metrics and just do rendered output from the test set not the val set

## 38. Comparison Metrics Source
**Question:** Should Pink Ward’s main model-comparison metrics come from the test set only, while the val set is used more for training-time feedback and internal tuning?

**Answer:** yes

## 39. Ad Hoc Testing Media
**Question:** For image and video inference outside the managed dataset, should Pink Ward allow ad hoc runs on arbitrary folders and files that are not imported into the project, or should all inference media have to be imported first?

**Answer:** yes you should be able to run it on random folders as well without importing but it should leave a history in the test section, not actually copying the files into the directory but leaving a pointer to the file location that test was run on

## 40. Validation vs Testing Boundary
**Question:** Should Pink Ward model validation and testing as two separate sections, where validation is only for labeled data physically imported into the project and testing is for arbitrary external folders, videos, or streams?

**Answer:** correct yes that is exactly how it should owrk

## 41. Missing External Test Source
**Question:** If an external file or folder used in the test section later gets moved or deleted, should Pink Ward keep the test history entry and mark the source as missing?

**Answer:** it should yes

## 42. External Test Run Storage
**Question:** Should external test runs still write their outputs, settings, and history entry into the project workspace, even though the source media stays outside the project?

**Answer:** correct

## 43. Multi-Model Val and Test Runs
**Question:** Should a test run always be tied to one specific model version, or do you want one action that can run multiple selected model versions against the same media for direct comparison?

**Answer:** in both test and val sections there should be an option to run with multiple models. For val it would be selecdt a certain amount of the set or press select all, then a window should open which models you want to do this for. Afterward it should output the metrics. For test it should allow you to chose x # of models to run tests with, x windows should pop up that all show the validation. If these are images pressing a button on the keyboard needs to make every window go to the next image. If its a video the videos must be synced. The top of the video window should have the name of the model being used in each window.

## 44. Fixed Validation Comparison Subset
**Question:** In a multi-model val comparison, should all selected models run against the exact same fixed subset of validation images for that comparison job?

**Answer:** yes they should

## 45. Validation Subset Selection
**Question:** When you choose a certain amount of the set for multi-model validation, should that amount be a count of images, a percentage of the validation set, or both?

**Answer:** when you press run it should allow you to choose images or choose a % of the dataset and sort by either the most recent x% or random images from the set

## 46. Validation Recency Basis
**Question:** For most recent validation sampling, should recency be based on when the files were imported into the project, not filesystem modified time?

**Answer:** yes when t were imported

## 47. Image Test Sync
**Question:** In the test section, when running multiple models on external images, should the synchronized viewer step all model windows through the exact same source image in lockstep?

**Answer:** yes

## 48. Video Test Timeline Sync
**Question:** For multi-model video testing, should the synced windows stay locked to one shared playback timeline, including pause, play, seek, and frame step?

**Answer:** yes

## 49. Independent Detections and Parallel Video Lanes
**Question:** For multi-model video testing, should Pink Ward allow different inference outputs to have slightly different detection events while still forcing playback sync, or do you want some stronger normalization across the displayed results?

**Answer:** yes each model will have its own independawnt detections. There also should be an option to add another video to the synced plater but even without running a model on it. There should be like an option to import as many videos as you want and then attach which modles should be run creating an instance for each model. Selecting no model should always be an option to just view an additional video in parallel. An example of this being useful would be to look at rgb and thermal vidoes but only haev the models running on the thermal video and just the user looking at rgb

## 50. Per-Video Start Offset
**Question:** If multiple videos are loaded into the synced player, should Pink Ward assume they are already time-aligned by the user, or do you want built-in controls to offset one video against another?

**Answer:** yeah allow the videos to be offest like u can set a start point on each video

## 51. Offset Persistence Scope
**Question:** Should those per-video offsets be saved as part of that specific test session, or should Pink Ward let the user save reusable alignment presets for the same video pairings?

**Answer:** yeah just in the session

## 52. Comparison Layout
**Question:** In a multi-model image comparison, do you want separate windows for each model as you described, or would one multi-pane comparison window also be acceptable?

**Answer:** yes panes is better

## 53. Video Comparison Layout
**Question:** Should that same pane-based layout also be used for multi-model video comparison, with one synced comparison workspace instead of many separate video windows?

**Answer:** yes

## 54. Mixed Pane Types
**Question:** In these pane-based comparison workspaces, should the user be able to mix pane types, for example one pane showing raw source video, another pane showing thermal with model A, another pane showing thermal with model B?

**Answer:** yes

## 55. V1 Pane Definition
**Question:** Should a pane always be defined by `(media source + optional model + session offset)`, or do you want more pane types than that in v1?

**Answer:** yes those are all the features needed

## 56. Ground Truth Validation Pane
**Question:** For val, should the pane workspace also support a raw ground-truth pane with labels only, so the user can compare model outputs against the labeled truth visually?

**Answer:** sure yes

## 57. Metrics vs Visual Review
**Question:** In val, should metrics be computed over the full selected subset even if the user only visually inspects part of it in the pane workspace?

**Answer:** yes they should be decoupled but either or should be able to be toggeled on or hidden

## 58. Error-Focused Validation Navigation
**Question:** In the val pane workspace, should the user be able to sort or jump directly to the worst-performing images, for example by false positives, false negatives, or low-confidence misses?

**Answer:** absoulutely yess

## 59. Ranked Validation Review Modes
**Question:** Should Pink Ward treat those error categories as first-class review filters in val, meaning the user can explicitly choose views like false positives, false negatives, class confusion, and low confidence?

**Answer:** yes but make these like like in the positive and make it so you can sort a list from top to bottom ie #of False Positives: Least Accurate, Most Accurate, False Negatives: Least Accurate, Most Accurate, Class accuracy: Least Accuracte, Most Accurate, Confidence: Least Confident, Most Confident

## 60. Per-Class Validation Review
**Question:** In v1, do you want only image-level ranked review, or also per-class ranked review?

**Answer:** we need a class filter yes

## 61. Shared Class Filter Scope
**Question:** Should the class filter apply to both the ranked list and the pane workspace, so choosing a class narrows the review set and the displayed overlays at the same time?

**Answer:** yes

## 62. Filtered vs Overall Metrics
**Question:** When a class filter is active, should metrics also recompute for that filtered class view, or should the metrics panel keep showing overall run metrics?

**Answer:** yes bot8h

## 63. Class Filter Timing
**Question:** Should val comparisons allow filtering down to one class before running the multi-model comparison, or should class filtering only happen after the run is complete?

**Answer:**  yes after so it has all the dat

## 64. Persistent Full Validation Results
**Question:** Should the saved val run keep the full unfiltered results permanently, so future review can apply different class filters and sort modes without rerunning inference?

**Answer:** yes

## 65. Persistent Full Test Results
**Question:** Should the same save full results, filter later rule also apply to test runs on external media?

**Answer:** yes

## 66. Test Review Without Ground Truth
**Question:** For test runs on unlabeled media, should Pink Ward still support confidence-based ranking and class filtering, even though false positives and false negatives cannot be computed without ground truth?

**Answer:** yes of course

## 67. Test Ranking Modes
**Question:** In test, do you want ranking modes tailored to unlabeled media, such as most detections, fewest detections, highest confidence, lowest confidence, and per-class presence?

**Answer:** probably should just havea calss filter and a confidence level.

## 68. Timeline Detection Tracks
**Question:** Should both test and val have timeline tracks that show where detections persist over time, grouped into continuous detections when successive frames likely refer to the same object?

**Answer:** The one thing the test and val need is they need the ability to highlight where detections are on the timeline. It should know if a dection in a video is the same thing as the last frame. My proposal is if the thing has a high amount of overlap say 70% or more (maybe should be higher if so let me know) overlap with a previous box on the last frame then it is considered the same detection. Each detection should be like a long line on the timeline of the videos for however long it is there. The detection line should appear vertically below the timeline, it needs to indicate what class it belongs to and what model it belongs to. The detection bar should be split into multiple colors horrizitonally that match the color of that calss if there is multi class dection. If there is multiple models just stack the detections under the timeline veritcally one line for each model.

## 69. Object Continuity Heuristic
**Question:** For deciding whether a detection in the next frame is the same object, should Pink Ward use overlap alone, or overlap plus same predicted class?

**Answer:** overlap plus same calss

## 70. Brief Gap Continuation
**Question:** If the same object briefly disappears for a few frames and then reappears with the same class and roughly the same position, should Pink Ward continue the same timeline detection segment or start a new one?

**Answer:** should continute yes\

## 71. Image Sequence Timeline
**Question:** Should those timeline detection tracks exist only for video, or do you also want an equivalent sequence view for ordered image sets?

**Answer:** no images need this feature too like for sure, the timeline should each just show a square that is the image and you can click between the squares. under the squares would be other squaes for each model/detetion similar to the video

## 72. Image Sequence Ordering
**Question:** For image sets, should Pink Ward treat the ordering as the import order by default, or should it preserve the original filename order unless the user changes it?

**Answer:** perserve

## 73. Source Folder Sorting Semantics
**Question:** If an imported image set has a clear numeric filename sequence, should Pink Ward use that as the timeline order automatically?

**Answer:** like no but it should just sort however it should just sort the way the folder its coming from sorts like which will account for numeric things if that makes any sense. if multiple folders are imported then literally just sort them like folder 1 with folder sorting rules, then folder 2 with folder sorting rules

## 74. Preserve Folder Boundaries
**Question:** If multiple folders are imported into one batch, should Pink Ward preserve folder boundaries in the image timeline rather than flattening everything into one merged list?

**Answer:** yes

## 75. Folder-Level Timeline Navigation
**Question:** In the image timeline view, should the user be able to jump folder-to-folder as well as image-to-image?

**Answer:** yes

## 76. Visible Folder Separators
**Question:** Should the timeline UI show folder labels or separators so the user can tell where one imported folder ends and the next begins?

**Answer:** yes just have like a big seperator line or something

## 77. Video-to-Frame Provenance
**Question:** For videos imported into the dataset, should Pink Ward slice them into frames during dataset import and retain a link from each frame back to the source video and timestamp?

**Answer:** okay like just a button that says like skip to place in video or smthing

## 78. Raw Video Retention Choice
**Question:** When importing a video into the dataset, should Pink Ward always keep the original raw video in project data as well as any sliced frames, or should the user be able to choose whether to keep the raw video?

**Answer:** sure but when it is imported have like keep video or keep frames only immediately pop up. and have the dataset seperated by frames and videos. when you click a video you should be able to get a timelinet hat has lindicators of where all the frames are

## 79. Separate Dataset Media Sections
**Question:** In the dataset view, should Videos and Frames be separate tabs or sections, rather than one mixed media list?

**Answer:** yes 

## 80. Clickable Frame Markers on Source Video
**Question:** When viewing a source video in the dataset, should the timeline markers for extracted frames be clickable so the user can jump directly to the frame positions?

**Answer:** yes like a go to source video thing

## 81. Reverse Jump from Frame to Source Video
**Question:** In the Frames section, should each frame also expose a reverse action like go to source video, opening the parent video at that frame’s timestamp?

**Answer:** yes that is what im saying

## 82. Missing Source Video for Kept Frames
**Question:** If a source video is deleted from the dataset but its derived frames are kept, should those frames remain usable and simply show the source video link as missing?

**Answer:** yes

## 83. Source Video After Frame Deletion
**Question:** If the user deletes derived frames but keeps the source video, should the video remain in the dataset with its frame markers removed accordingly?

**Answer:** yes that particular frame will just not be there

## 84. Saved Frame Extraction Settings
**Question:** Should frame extraction settings, like the seconds interval used when slicing a video, be saved per imported video so Pink Ward can show how a given frame set was created?

**Answer:** yes

## 85. Batch Link for Derived Frames
**Question:** Should Pink Ward also record which imported batch created those frames, so the source video, extracted frames, and import event stay linked together?

**Answer:** yes

## 86. Unlabeled Image Import Rejection
**Question:** When importing labeled image data, should Pink Ward reject unlabeled images by default, or allow them into the dataset in some inactive state?

**Answer:** yes reject them if they dont have a matching label

## 87. Orphan Label Rejection
**Question:** Should Pink Ward also reject label files that have no matching image, rather than importing broken pairs?

**Answer:** yes

## 88. Partial Import Acceptance
**Question:** If an import contains some valid pairs and some invalid files, should Pink Ward allow a partial import of the valid data while reporting the rejected items, or should the whole import fail?

**Answer:** yes everything that is valid should be allowed in

## 89. Rejected Import Report Persistence
**Question:** Should the rejected import items be saved in an import report that remains attached to the batch history, not just shown once in a popup?

**Answer:** yes show which files were rejected but only after the import like dont store it permantly

## 90. Duplicate Pair Skipping
**Question:** During import, if Pink Ward detects duplicate image-label pairs that are byte-for-byte identical to data already in the project, should it skip them automatically rather than importing duplicates?

**Answer:** yes

## 91. Duplicate Detection Beyond Filenames
**Question:** If two files have different filenames but identical image content and identical labels, should Pink Ward still treat them as duplicates and skip one?

**Answer:** okay yes 

## 92. Same Image Different Labels Conflict
**Question:** If the image bytes are identical but the label files differ, should Pink Ward treat those as distinct dataset items rather than duplicates?

**Answer:** okay just make it replace actually

## 93. Replace Keeps Item Identity
**Question:** If the user chooses replace in that popup, should Pink Ward update the existing dataset item’s labels while keeping its identity and history, rather than creating a brand new item?

**Answer:** yes

## 94. Duplicate Suppression for Label Conflicts
**Question:** If the user chooses duplicate, should Pink Ward allow the same underlying image content to exist twice in the dataset with different labels, each as a separate managed item?

**Answer:** okay just make it replace actually

## 95. Explicit Replacement Target
**Question:** When labels are replaced on an existing dataset item, should Pink Ward record that as a history event on the item so the user can see that its annotation changed?

**Answer:** yes

## 96. Preserve Split on Label Replacement
**Question:** If an item’s labels are replaced, should any existing split assignment (train / val / test) stay the same by default?

**Answer:** yes it should stay the same

## 97. Block Replacement on Unmapped Class
**Question:** If a label replacement introduces a brand-new class that does not yet exist in the project’s canonical class list, should Pink Ward block the replacement until the class mapping is resolved?

**Answer:** yes

## 98. Reuse Class-Mapping Flow
**Question:** Should Pink Ward reuse the same class-mapping resolution flow for both dataset import and label replacement?

**Answer:** yes this should be used

## 99. Rename Existing Project Classes
**Question:** Should Pink Ward allow users to rename project classes after data has already been imported, as long as the underlying canonical class identity stays the same?

**Answer:** yes

## 100. Class Deletion With Dependent Labels
**Question:** Should class deletion be allowed only if no active dataset items, labels, or model histories still depend on that class?

**Answer:** yes but if you go to delete it it should give the option to delete any labels that are associated. if the image would be left with 0 labels another option should come up to delete the images that now have no lables entirely

## 101. Explicit Confirmation for Empty-Image Deletion
**Question:** If a class is deleted and Pink Ward removes all labels of that class from some images, should those now-empty images be deleted automatically only if the user explicitly confirms it in that follow-up option?

**Answer:** explicit confirmation

## 102. Empty Images as Negative Examples
**Question:** If the user declines deleting those now-empty images, should Pink Ward soft-delete them from the active dataset anyway, or keep them as invalid empty images?

**Answer:** no they should just be left as images with empty labels. this is important if the user wants these images to represent a negtaive ID

## 103. Importing Negative Examples
**Question:** Should Pink Ward also allow intentionally importing empty-label images as negative examples, or only allow empty labels when they arise from later editing like class deletion?

**Answer:** no allow importing them too

## 104. Empty Label Files as Valid Negatives
**Question:** Should Pink Ward treat an empty label file as the valid representation of a negative example, while still rejecting images that have no matching label file at all?

**Answer:** yes

## 105. Negative Examples in Splits
**Question:** Should negative examples with empty label files participate in train, val, and test splits just like positively labeled images?

**Answer:** yes

## 106. Balance Negative Examples Across Splits
**Question:** When balancing splits, should Pink Ward account for the share of negative examples too, so one split does not end up with almost all the empty-label images?

**Answer:** yes

## 107. Filterable Negative Examples
**Question:** Should Pink Ward visibly tag negative examples in the dataset UI so the user can filter or review them explicitly?

**Answer:** yes it should havr a filter for all calsses including empty

## 108. Empty as Special Filter State
**Question:** Should empty be treated as a special built-in filter state rather than as a normal editable class in the project class list?

**Answer:** yes

## 109. Empty Filter in Validation Review
**Question:** In validation review, should the class filter also support empty so the user can inspect how models behave on negative examples specifically?

**Answer:** yes

## 110. Ranking Negative Validation Examples
**Question:** For empty validation review, should Pink Ward rank those images mainly by number of detections and confidence, since any detection on a true negative is effectively a false positive?

**Answer:** sure yes

## 111. Empty Filter in Test Review
**Question:** Should empty also appear in the test-side class filter, even though test media may not have ground truth negatives in the same formal sense?

**Answer:** no

## 112. Dataset Class Counters
**Question:** Should Pink Ward show project-level dataset counts by class, including empty negatives?

**Answer:** yes plelase have a counter with each class

## 113. Class Counter Unit
**Question:** Should those class counters count images containing the class, label instances of the class, or both?

**Answer:** labels

## 114. Empty Counter Unit
**Question:** For empty, since there are no labels to count, should its counter represent number of images rather than label instances?

**Answer:** yes

## 115. Active-Only Class Counters
**Question:** Should the class counters reflect only active dataset items by default, excluding anything soft-deleted or in trash?

**Answer:** yes but no need for having a counter for deleted data

## 116. Live Counter Updates
**Question:** Should these class counters update immediately after imports, deletions, label replacements, and class deletions, rather than only after a refresh or recompute action?

**Answer:** yes

## 117. Trained vs New Data Summary
**Question:** Should the project also show a summary for how much of the active dataset has already been included in at least one training snapshot versus how much is new since the last training cycle?

**Answer:** absoultely yes

## 118. Item-Level Training Coverage
**Question:** Should that trained-vs-new summary be based on individual active dataset items, not just batches?

**Answer:** individual yes

## 119. New Since Last Completed Training
**Question:** For new since last training cycle, should Pink Ward compare against the most recent completed training run only, or against all prior training history?

**Answer:** but acutally also have an option somwhere to change what iteration you are comparing the current dataset to, but yes it should default to the newest model

## 120. Ever-Trained Indicator
**Question:** Separately from new since last training, should Pink Ward also be able to show whether an item has ever been used in any training run at all?

**Answer:** okay sure but definitely have the feature to select all things in one batch, when importing a batch MAKE SURE the user has to name the batch

## 121. Required Batch Naming
**Question:** Should every batch import require a user-provided batch name before the import can complete?

**Answer:** yes

## 122. Training Dataset Scope Modes
**Question:** Should Pink Ward allow training on all active data by default, while still letting the user scope training to selected batches when they intentionally want to?

**Answer:** sure but when starting training make it like they have to choose either all data, include certain data or exclude certain data

## 123. Batch as Training Scope Unit
**Question:** In those include certain data and exclude certain data modes, should the selectable units be batches first, with finer-grained filters added later only if needed?

**Answer:** batch

## 124. Save Training Scope in Run Metadata
**Question:** Should the chosen training scope, including the exact included or excluded batches, be saved into the training run record and model version metadata?

**Answer:** yes

## 125. Scope-Aware New Data Comparison
**Question:** When Pink Ward shows new since last training, should that comparison respect the selected training scope of the last run, not just assume all active data was used?

**Answer:** yes

## 126. Older Iteration Baseline Uses Saved Scope
**Question:** When comparing the current dataset to an older selected iteration, should Pink Ward use that older run’s exact saved scope and snapshot as the comparison baseline?

**Answer:** yes

## 127. Batch Metadata in Training Scope UI
**Question:** In the training UI, should batch selection show helpful metadata like batch name, import date, item count, and whether the batch has been used in the latest training run?

**Answer:** yes

## 128. Batch Class Composition in Scope UI
**Question:** Should the training scope chooser also show per-batch class composition counts, or is that too much for v1?

**Answer:** yes

## 129. Default Training Scope Selection
**Question:** Should the default training scope option be preselected as all active data, with include certain data and exclude certain data as explicit overrides?

**Answer:** yes but if incude certain data is selected it should delect everything

## 130. Rare-Class Exclusion Warning
**Question:** Should Pink Ward warn the user before starting training if their selected scope excludes batches that contain rare classes, since that can materially distort the run?

**Answer:** yes

## 131. Explicit Confirmation for Risky Scope
**Question:** Should that warning be informational only, or should Pink Ward require explicit confirmation before continuing?

**Answer:** confirm

## 132. Low-Sample Scope Warning
**Question:** Should Pink Ward also warn if the chosen training scope leaves too few total images in train, val, or test after filtering?

**Answer:** yes

## 133. Custom Split at Train Time
**Question:** Should the training form let the user edit split ratios there too, or should split management stay in the dedicated split area and training only consume the current split state?

**Answer:** no when you press train there should be an option to like do a custom split

## 134. One-Off Training Split
**Question:** Should that custom split apply only to the one training run, leaving the project’s default split settings unchanged unless the user explicitly saves it?

**Answer:** yes

## 135. Save One-Off Split Snapshot
**Question:** When using a custom split for one run, should Pink Ward save the exact resulting split snapshot into that training run’s metadata just like any other run?

**Answer:** yesy

## 136. Explicit Split Mode Choice in Train Dialog
**Question:** Should the train dialog offer use current split and create custom split for this run as explicit mutually exclusive choices?

**Answer:** yes

## 137. Custom Split Seed at Train Time
**Question:** If the user chooses create custom split for this run, should Pink Ward also let them set a custom seed for that run’s split?

**Answer:** yes

## 138. Prefill Custom Split Seed
**Question:** Should the train dialog prefill the custom split seed with the project’s current seed, while still allowing the user to edit it?

**Answer:** sure

## 139. Explicit Split Metadata on Every Model
**Question:** When a custom split is used for training, should the resulting model or version comparison views clearly indicate that it was trained on a custom split rather than the project default split?

**Answer:** every model should say what exact split it was trained on in like an information section even the models trained with the default split should explitly say x train/x val/x test

## 140. Split Ratios and Counts on Model Info
**Question:** In that model information section, should Pink Ward show both the split ratios and the exact item counts for train, val, and test?

**Answer:** yes

## 141. Batch Scope Dropdown in Model Info
**Question:** Should the model information section also show which batches were included or excluded for that run?

**Answer:** yes but it should be in a dropdown

## 142. Split Seed in Model Info
**Question:** Should the model information section also show the split seed that was used for that run?

**Answer:** yes

## 143. Training Hyperparameters in Model Info
**Question:** Should Pink Ward also show the training hyperparameters in that same model information area, like epochs, batch size, workers, image size, and similar settings?

**Answer:** yes

## 144. Clone Previous Training Settings
**Question:** Should the user be able to start a new training run by cloning a previous model’s settings into the train form and then editing them?

**Answer:** yes

## 145. Training Defaults vs Clone Behavior
**Question:** Should the train form default to the most recent model’s settings when starting a new run, or should cloning always be a separate explicit action?

**Answer:** no it should default to whatever defaults are set to there should be a set as default button weh you change the training perameters next to run

## 146. Per-Project Training Defaults
**Question:** Should those training defaults be stored per project, not globally across all Pink Ward projects?

**Answer:** ah yes my bad per project is better

## 147. Default Starting Weights in Project Defaults
**Question:** Should the project’s training defaults include the default model architecture or checkpoint starting point as well, not just numeric hyperparameters?

**Answer:** yes

## 148. Built-In vs Prior-Model Starting Points
**Question:** Should Pink Ward support both starting from a built-in base model and fine-tuning from a previous project model version as first-class options in the train form?

**Answer:** yes

## 149. Explicit Parent-Child Model Lineage
**Question:** When fine-tuning from a previous project model, should Pink Ward record that parent-child relationship explicitly so lineage between versions is navigable?

**Answer:** yes

## 150. Expose Model Lineage in Comparison UI
**Question:** Should the model comparison area expose that lineage, for example showing which versions branched from which parent, rather than only listing flat versions like v1, v2, v3?

**Answer:** yes

## 151. Import External Starting Weights
**Question:** Should Pink Ward allow starting training from an external `.pt` weights file that is not already a managed project model?

**Answer:** yes it should but it should then be imported

## 152. Managed Entry for Imported External Weights
**Question:** When an external starting weights file is imported, should it become a managed model entry even if it has no Pink Ward training history yet?

**Answer:** yes

## 153. Original vs Iteration Tagging
**Question:** Should imported external weights be visually distinguishable from models trained inside Pink Ward, for example tagged as imported or external origin?

**Answer:** no its literally the exact same they are not different because now the external model has just become an internal model no? Just have all models that are v1s have a orginal tag and have the iterations have an iteration tag

## 154. Finalized Original vs Iteration Model Tags
**Question:** Should Pink Ward tag root models as original and derived models as iteration, instead of showing a separate external provenance tag?

**Answer:** yes

## 155. Multiple Original Root Models Per Project
**Question:** Should a project be allowed to contain multiple original root models, not just one v1 lineage?

**Answer:** yes

## 156. Lineage-Local Version Numbering
**Question:** If multiple root models exist, should version numbering like v1, v2, v3 remain project-global, or should each root lineage have its own local numbering?

**Answer:** edit: each root should have a name and numbering

## 157. Explicit Base Model Naming
**Question:** Should Pink Ward require the user to name each root model lineage explicitly, so versions are understood as something like ThermalBase v1, ThermalBase v2, RGBBase v1?

**Answer:** yes the user should name the base model explicitly

## 158. Separate Model Line From Direct Parent
**Question:** Should Pink Ward separate model line from direct parent, so a version can stay in the same named line even when it is retrained fresh from stock instead of fine-tuned from the previous version?

**Answer:** yes

## 159. Explicit Training Start Modes
**Question:** When starting training, should the user explicitly choose between train from stock or base architecture, fine-tune from existing model, and import external weights then train?

**Answer:** yes

## 160. Line Versioning With Run-Type Labels
**Question:** Should versions in the same model line keep incrementing normally, while also showing a run-type label such as Fine-tuned, New from stock, or New from imported?

**Answer:** yes sure that works 

## 161. No Run-Type Filtering in Comparison UI
**Question:** In the model comparison UI, should the user be able to filter or group versions by these run types (Fine-tuned, New from stock, New from imported)?

**Answer:** no that serves no purpose the sorting filter should be like only by like model line

## 162. Recent-First Model Comparison Default View
**Question:** Should the model comparison UI default to showing one model line at a time, with the option to add another line for cross-line comparison when needed?

**Answer:** the ui should defualt show most recently trained models doesnt matter what line the user can then filter by line if they want

## 163. Show Line Name in Recent-First View
**Question:** In that recent-first default view, should Pink Ward still display each model’s line name prominently so the user can immediately see which line each recent model belongs to?

**Answer:** yes

## 164. Active Models Only in Recent List
**Question:** Should the recent-first model list default to all active models, excluding soft-deleted ones and trash?

**Answer:** yes

## 165. Scroll-Based Recent Model Loading
**Question:** Should the recent-first model list have a user-controlled limit, like show last 10 / 25 / 50 models, to avoid becoming noisy in large projects?

**Answer:** no it should just be a scoll thing that only has as certain amount unless u scroll down

## 166. Scroll Loading for Model Lines
**Question:** Should the same scroll-loaded behavior apply to model lines too, so a line with many versions just expands naturally as the user scrolls?

**Answer:** yes

## 167. Cross-Line Model Comparison Selection
**Question:** In the model comparison surface, should selecting multiple models for comparison be independent of the list sort and filter, meaning the user can compare models from different lines if they choose?

**Answer:** yes there should be a little thing that incidicates how many modles are currently selected

## 168. No Comparability Warning on Cross-Scope Comparison
**Question:** Should Pink Ward warn the user when they compare models that were trained on materially different scopes or split snapshots, since the comparison may be less apples-to-apples?

**Answer:** no

## 169. Scope Metadata Behind Information View
**Question:** Even without warnings, should the comparison view still show each model’s saved training scope and split metadata in its info section?

**Answer:** yes sure but only if the user presses like an information thing then it should show a screen that is scrollable that has each modles scope

## 170. Side-by-Side Metadata Comparison
**Question:** Should that scrollable information view be able to show multiple selected models side by side for metadata comparison, or should it be one model at a time?

**Answer:** side by side yes

## 171. Highlight Metadata Differences
**Question:** In that side-by-side info view, should fields that differ between models be visually highlighted so differences are easy to spot?

**Answer:** sure yes

## 172. Persist Model Selection Through UI Changes
**Question:** Should the comparison UI remember the current selected models while the user opens and closes these info views, filters, and sort changes, instead of clearing the selection?

**Answer:** yes

## 173. Selected-Models Focus View
**Question:** Should there be a clear selection action visible in the model comparison UI once any models are selected?

**Answer:** there should just be the ability to clieck on selected models so u can see them all without seeing anything else and its easy to deleect what you want

## 174. Preserve Sort Order in Selected-Models View
**Question:** Should that selected models view still preserve the normal sort order among the selected items, or should it just show them in the order they were selected?

**Answer:** yes

## 175. Shared Selection State Across Views
**Question:** When the user deselects models inside that focused selected-models view, should the main comparison list update immediately in the background so returning to it keeps everything in sync?

**Answer:** yes

## 176. Mouse-First Model Comparison Interaction
**Question:** Should the model comparison area support keyboard shortcuts for selection actions, or is mouse-first interaction enough for v1?

**Answer:** mouse is good enough

## 177. One Training Run at a Time Per Project
**Question:** Should training runs execute one at a time per project, or do you want Pink Ward to allow multiple concurrent training jobs within the same project?

**Answer:** one at a time

## 178. Only One Heavy Job Per Project
**Question:** If a training run is active for one project, should Pink Ward still allow validation and test runs in that same project, or should the whole project be effectively busy?

**Answer:** no only allow either the training loop or a test to be run at once dont let more than 1 happen

## 179. Disable Blocked Heavy Actions Instead of Queueing
**Question:** If one heavy job is already running in a project, should the blocked action just be disabled in the UI, or should the user still be able to queue the next job?

**Answer:** disable

## 180. Live Heavy-Job Status Area
**Question:** While a heavy job is running, should Pink Ward show a live job status area with progress, current phase, logs, and elapsed time?

**Answer:** yes

## 181. Persist Run Logs and Completion Time
**Question:** Should that live status area persist after completion as a saved run log, or is it only a temporary live console?

**Answer:** yes keep it in the run record including time it took to train to completion for sure

## 182. Keep Failed Job Records
**Question:** If a training or test job fails, should Pink Ward keep a failed run record with the logs and failure state, rather than pretending the run never happened?

**Answer:** ye

## 183. Show Failed Runs in Normal History
**Question:** Should failed runs appear in the same history lists as successful runs, just clearly tagged with their status?

**Answer:** yes

## 184. Retry Failed Runs From Saved Settings
**Question:** Should the user be able to retry a failed training or test run by reopening its saved settings into the form?

**Answer:** yes

## 185. Cancel Active Heavy Jobs
**Question:** Should the user also be able to cancel an active training or test job from the live status area?

**Answer:** yes

## 186. Distinct Cancelled Run State
**Question:** If the user cancels an active training or test job, should Pink Ward save that as a distinct cancelled state rather than treating it as failed?

**Answer:** yes

## 187. Keep Partial Artifacts But Disallow Normal Use
**Question:** If a training run is cancelled partway through, should Pink Ward keep any partial artifacts it already produced, like logs or intermediate weights, or clean them up automatically?

**Answer:** yes keep them but dont let them be referenced for stuff like test 

## 188. Incomplete Artifacts in History
**Question:** Should those incomplete or cancelled model artifacts still appear in model history, just clearly tagged as unusable for normal downstream actions?

**Answer:** sure if the user interntionally navigated to themk

## 189. Hide Incomplete Models in Normal Selectors
**Question:** Should normal model selection UIs for training, validation, and testing hide incomplete models by default, with an explicit way to reveal them if the user wants to inspect history?

**Answer:** yes

## 190. Elapsed Time for Test and Validation Runs
**Question:** Should completed test and validation runs also record total elapsed time to completion, just like training runs?

**Answer:** yes

## 191. Per-Phase Timing When Available
**Question:** Should Pink Ward also record per-phase timing when available, like setup time, inference time, metrics generation time, and export or render time?

**Answer:** sure

## 192. Compact Run History Status Summary
**Question:** Should the run history list show a compact status summary at a glance, like completed, failed, cancelled, elapsed time, and model used, before the user opens the detailed record?

**Answer:** yes

## 193. Show Media or Dataset Target in Run History
**Question:** Should the history list also show the media target or dataset subset used for that run, so the user can distinguish runs without opening each one?

**Answer:**   yes

## 194. No User Renaming of Run History Entries
**Question:** Should run history entries be renameable by the user, or should their naming remain system-generated from metadata?

**Answer:** no renaming by the user

## 195. Mutable Run History With Artifact Deletion
**Question:** Should Pink Ward allow soft-deleting run history entries, or should run history be immutable once created?

**Answer:** yes allow deleting models etc intermediate and failed runs whatever and if the model is deleted or whatever the run is attatached to that is deleted that needs to be delted as well. so the runs actually should definitely be mutable

## 196. Trash Then Auto-Purge After 30 Days
**Question:** Should deletion of a model or run move its heavy artifacts to trash first, with the same recoverable flow you wanted for data, rather than hard-deleting immediately?

**Answer:** yes but it should self delete after 30 days

## 197. Uniform 30-Day Trash Retention
**Question:** Should that 30-day auto-purge apply to trashed data, models, and runs uniformly, or do you want different retention periods by category?

**Answer:** everything yes

## 198. Show Scheduled Purge Date in Trash
**Question:** Should the trash view show the scheduled purge date for each item so the user knows when it will disappear automatically?

**Answer:** yes

## 199. Manual Empty Trash Option
**Question:** Should the user also be able to empty trash manually before the 30-day deadline?

**Answer:** yes

## 200. Strong Confirmation for Empty Trash
**Question:** Should empty trash require a stronger confirmation than normal deletion, since it bypasses the remaining recovery window?

**Answer:** yes

## 201. Restore Original Relationships Automatically
**Question:** Should restoring a trashed item return it to its original section and relationships automatically, for example a model back to its model line or data back to its batch?

**Answer:** yes

## 202. Prompt on Restore Dependencies
**Question:** If restoring one item depends on another trashed item, should Pink Ward restore the dependency too or block the restore until the user chooses?

**Answer:** yes

## 203. Explicit Dependency List in Restore Prompt
**Question:** Should the restore prompt list the dependent items explicitly so the user knows exactly what else will come back?

**Answer:** yes

## 204. Project-Level Storage Summary
**Question:** Should Pink Ward include a project-level storage summary, like how much space is used by data, models, runs, outputs, and trash?

**Answer:** yes

## 205. Storage Drilldown to Largest Items
**Question:** Should that storage summary break down usage by section only, or also let the user drill into the biggest individual batches, models, videos, and outputs?

**Answer:** yes

## 206. Storage View as Cleanup Entry Point
**Question:** Should the storage view let the user jump directly from a large item to the relevant item page or delete or trash action?

**Answer:** yes

## 207. Show Free Disk Space for Workspace Drive
**Question:** Should Pink Ward also show estimated free disk space for the workspace drive, so the user can judge whether a big import, slicing job, or training output is safe?

**Answer:** yes

## 208. Low Disk Space Warning and Output Disk Choice
**Question:** Before starting especially large operations like video slicing, imports, or rendered output generation, should Pink Ward warn the user if free disk space looks dangerously low?

**Answer:** yes, it should also allow the user to change the disk the things is being output on so that external storage can be useful

## 209. Per-Project Storage Targets by Category
**Question:** Should Pink Ward support per-project storage locations for major output categories, like data, models, and renders, so some can live on external storage while the project metadata stays rooted in Pink Ward?

**Answer:** yes

## 210. External Storage Still Project-Managed
**Question:** Should those alternate storage targets still be managed as part of the same project, meaning Pink Ward tracks them as project-owned paths even if they are on another drive?

**Answer:** yes

## 211. Explicit Unavailable State for Missing Storage
**Question:** If an external storage target is missing or disconnected, should Pink Ward mark that project section as unavailable rather than silently failing?

**Answer:** yes

## 212. Partial Project Availability With Missing Storage
**Question:** If a required storage target is unavailable, should Pink Ward block actions that need it but still allow the rest of the project to open normally?

**Answer:** yes

## 213. Rebind Missing Storage Target
**Question:** Should Pink Ward let the user rebind a missing storage target to a new path and then revalidate the affected project content?

**Answer:** sure

## 214. No Built-In Labeling in V1
**Question:** Do you want any built-in labeling or label-editing capability in v1, even a minimal bbox correction tool, or should v1 assume labels are created elsewhere and Pink Ward only manages, imports, trains, validates, and tests?

**Answer:** v1 = no labeling software

## 215. No Live Streams in V1
**Question:** Should v1 support live stream inference as a first-class workflow, or should Pink Ward focus on datasets, images, and videos only?

**Answer:** v1 = no live streams

## 216. No Sharing in V1
**Question:** Should Pink Ward include any sharing or collaboration features in v1?

**Answer:** v1 = no sharing

## 217. Local Files Only in V1
**Question:** For v1, should Pink Ward support only local image folders, local videos, and imported labeled datasets as inputs, with no camera feeds, RTSP streams, or browser or video URLs?

**Answer:** yes

## 218. Exportable Summary Artifacts in V1
**Question:** Do you want Pink Ward to generate any exportable summary artifacts in v1, like CSV or JSON reports of metrics and run metadata, or is the in-app history and review UI enough?

**Answer:** it should yes

## 219. CSV and JSON Are Sufficient for V1 Reports
**Question:** For v1, is CSV plus JSON enough for exported reports, or do you also want generated human-readable documents like PDFs?

**Answer:** that is enough

## 220. Export Reports for All Run Types
**Question:** Should those CSV and JSON exports be available for training runs, validation runs, and test runs all three, or only for some of them?

**Answer:** all three

## 221. First-Run Environment Check
**Question:** Do you want Pink Ward to include a simple first-run environment and setup check in v1, verifying Python, Ultralytics, and key runtime dependencies before the user starts work?

**Answer:** yes

## 222. Attempt Self-Healing Dependency Install
**Question:** Should Pink Ward try to install missing Python dependencies itself from the app when possible, or just detect the issue and tell the user what is missing?

**Answer:** absoulutely yes try to install

## 223. Show Self-Healing Install Output
**Question:** Should Pink Ward show the exact install command and output when it tries to self-heal dependencies, so the user can see what succeeded or failed?

**Answer:** sure

## 224. Global App-Level Python Environment
**Question:** Should Pink Ward treat Python environment setup as global to the app installation, not separate per project?

**Answer:** yes of course

## 225. Offline Normal Operation
**Question:** Should Pink Ward require internet only for setup and dependency install and otherwise function fully offline for normal project use?

**Answer:** yes it should be fully offline for normal use

## 226. Project-Level Notes in V1
**Question:** Should Pink Ward include a project-level notes field or text area in v1 for arbitrary user notes about the project, models, or runs?

**Answer:** sure yes that could be helpful

## 227. Model and Run Notes in V1
**Question:** Should model versions and runs also support their own notes fields, or is project-level notes enough for v1?

**Answer:** yes that works

## 228. Plain Text Notes Only in V1
**Question:** Should notes be plain text only in v1, or do you want rich text or Markdown support?

**Answer:** plain text

## 229. Autosave Notes
**Question:** Should Pink Ward autosave notes immediately as the user types, or require an explicit save action?

**Answer:** autosave for sure

## 230. Include Notes in Relevant Exports
**Question:** Should notes be included in the CSV and JSON exports where relevant, for example run notes attached to a run export?

**Answer:** yes suer

## 231. Global Search in V1
**Question:** Should Pink Ward include a simple global search across project names, batch names, model lines, versions, and notes in v1?

**Answer:** yes please

## 232. Text-Only Global Search
**Question:** Should that search stay text-only in v1, or do you also want structured filters mixed into it immediately?

**Answer:** text only

## 233. Search Results as Direct Jump Targets
**Question:** Should the global search return direct jump targets into the relevant screen, not just raw result text?

**Answer:** yes

## 234. No Formal Onboarding Wizard in V1
**Question:** Do you want a formal onboarding or wizard flow in v1, or is a straightforward home screen plus project creation flow enough?

**Answer:** straightforward home screen for now we can add that later
