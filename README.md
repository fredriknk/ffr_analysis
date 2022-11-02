FFR Analysis Program
=======================================
_Written by Lars Molstad_

The FFR analysis program is a python based interpreter for files generated by the Field Flux Robot. 

The program is structured in the following way:

```
ffr_analysis
│   README.md   
|   metno_client_id.txt
└───Prog  #DO NOT CHANGE
│      
└───example_data  #example data for testing of regression functions without actual FFR data
|   │   file021.txt
|
└───Users #Individual folders for each use case of the program 
    |
    └───LarsM
    |
    └───...
    |
    └───Fredrik
        |   config.yml
        |   specific_options.pickle
    
```

Where each user folder will represent a specific field or method for analysing data. 

If downloading the FFR analysis program for the first time, a few things have to be done before you can run the program. 
1. Download the Anaconda package with spyder IDE
2. Clone the ffr_analysis repo
3. Create a file with a config.yml file with the paths to your data folders
   The yml config file should have a structure like this:
```
PATHS:
    RAWDATA: C:\path\to\rawdata\folder\
    MANUAL: C:\path\to\manual\measurements\file.xlsx
    LOGGER_PATH: C:\path\to\combined\logger\file.xlsx
```
4. Create a user at [met.no](https://frost.met.no/howto.html) and put the client id in a file named: metno_client_id.txt in the ffr_analysis top folder