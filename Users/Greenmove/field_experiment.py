"""
 Fredriks capture experiments
"""
 
# First, select this file's directory in the white bar up to the
# right. You can do this by right-clicking on ".py" above and choosing
# "Set console working directory"
 
# The button that runs current "cell" executes the code highlighted
# (Cells are code between lines starting with # %%)
  
# %% Imports:
import sys
import os
import glob
from collections import namedtuple
import numpy as np
import pylab as plt
import pandas as pd
import logging
pd.options.mode.chained_assignment = None
pth = os.path.realpath(os.path.join(os.getcwd(), '../../prog'))
if not pth in sys.path:
    sys.path.append(pth)
import resdir
import get_data
import utils
import find_regressions
import sort_results as sr
import weather_data
import flux_calculations
import polygon_utils
from weather_data_from_metno import update_weather_data, make_data_file
from yaml import safe_load
from ffr_gui import make_dataset, check_exclude

logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logging.getLogger('matplotlib.font_manager').disabled = True

def read_yaml(file_path = "config.yml"):
    with open(file_path, "r") as f:
        return safe_load(f)


def plot_something(df, key, value, what="N2O", **kwargs):
    d = df[df[key]==value]
    kwargs = {**{'linewidth': .5, 'marker':'.', 'markersize':2}, **kwargs}
    plt.plot(d.days, d.N2O_N_mug_m2h if what=="N2O" else d.CO2_C_mug_m2h,
             label=value, **kwargs)

def plot_treatment(df, treatment, what="N2O", **kwargs):
    plot_something(df, 'treatment', treatment, what, **kwargs)

def plot_nr(df, nr, what="N2O", **kwargs):
    plot_something(df, 'nr', nr, what, **kwargs)

def position(filename):
    a = get_data.parse_filename(filename)['vehicle_pos']
    return np.array([a['x'], a['y']])

def file_belongs(filename):
    name = os.path.split(filename)[1]
    date_ok = start_date <= name.replace('-','') <= stop_date
    x, y = position(filename)
    pos_ok = 0 < x - offset.x < 45 and 0 < y - offset.y < 55
    #text_ok = name.find('Measure') > -1
    return date_ok and pos_ok
def finalize_df(df, precip_dt=2):
    df['Tc'] = weather_data.data.get_temp(df.t)
    df['precip'] = weather_data.data.get_precip(df.t)
    df['N2O_mol_m2s'] = flux_calculations.calc_flux(df.N2O_slope, df.Tc)
    df['CO2_mol_m2s'] = flux_calculations.calc_flux(df.CO2_slope, df.Tc)
    Nunits = flux_units['N2O']
    Cunits = flux_units['CO2']
    df[Nunits['name']] = Nunits['factor'] *  df.N2O_mol_m2s
    df[Cunits['name']] = Cunits['factor'] *  df.CO2_mol_m2s
    df = sr.rearrange_df(df)
    return df

def find_treatment_number(plot_number,treatment_legends):
    """
    This function takes a plot number and returns the treatment number
    based on the treatment_legend provided.
    """
    for treatment_number, details in treatment_legends.items():
        if plot_number in details['plots']:
            return treatment_number
    return None


fixpath = utils.ensure_absolute_path

start_date = '2021-08-19'
stop_date =  '2099-01-01'  #YYYYMMDD  stop_date has to be one day after the last date you want
redo_regressions = False

try:
    update_weather_data()
except:
    make_data_file()


options = {'interval': 100,
           'start':0,
           'stop':180,
           'crit': 'steepest',
           'co2_guides': True,
           'correct_negatives':False,
           'cut_beginnings':7,
           'cut_ends':7
           }

save_options= {'show_images':False,
               'save_images':False,
               'save_detailed_excel':False,
               'sort_detailed_by_experiment':False,
               'show_last_runs':False
               }

remove_redoings_time = 10 #seconds

flux_units = {'N2O': {'name': 'N2O_N_mug_m2h', 'factor': 2 * 14 * 1e6 * 3600},
              'CO2': {'name': 'CO2_C_mug_m2h', 'factor': 12 * 1e6 * 3600}}

specific_options_filename = fixpath('specific_options.pickle')

try:
    DATA_FILE_NAME = "config.yml"
    paths = read_yaml(DATA_FILE_NAME)["PATHS"]
    resdir.raw_data_path = paths["RAWDATA"]
    if "MANUAL" in paths:
        manual_path = paths['MANUAL']
    if "LOGGER_PATH" in paths:
        logger_path = paths['LOGGER_PATH']
except FileNotFoundError:
    print(DATA_FILE_NAME + ' not found')
    resdir.raw_data_path = fixpath('raw_data')

detailed_output_path = fixpath('output/detailed_regression_output_unsorted')
find_regressions.make_detailed_output_folders(detailed_output_path)

excel_filename_start = "output/capture"
slopes_filename = fixpath("output/capture_slopes.txt")

# Finding the raw data files
all_filenames = glob.glob(os.path.join(resdir.raw_data_path, '2*'))
print("number of measurement files from robot: %d" % len(all_filenames))
filename_substring = "_Plot_" # all result file names should contains this

slopes_filename = fixpath("output/slopes_"+ filename_substring + ".txt")

if not os.path.isfile(slopes_filename):
    open(slopes_filename, 'a').close() #creates the file
# Finding the raw data files
all_filenames = glob.glob(os.path.join(resdir.raw_data_path, '2*'))
print("number of measurement files from robot: %d" % len(all_filenames))

# hvis noen filer er helt ødelagt:
broken = []

def file_belongs(filename):
    name = os.path.split(filename)[1]
    date_ok = start_date <= name.replace('-','') <= stop_date
    text_ok = name.find(filename_substring) > -1
    return date_ok and text_ok and (name not in broken)

filenames = [x for x in all_filenames if file_belongs(x)]

if len(filenames) == 0:
    raise Exception("No files found. Check filename_substring etc")
print('number of measurement files included in this run:', len(filenames))

filenames.sort() # alphabetically (i.e., by date)

# Make the "regressor object" regr which will be used further below.
# It contains the functions and parameters (options) for doing the regressions.

regr = find_regressions.Regressor(slopes_filename, options, save_options,
                                  specific_options_filename, detailed_output_path)

if not os.path.isfile(slopes_filename):
    open(slopes_filename, 'a').close() #creates the file

logging.debug(f"filnames fe: {filenames}")
if redo_regressions:
    regr.find_regressions(filenames)
else:
    regr.update_regressions_file(filenames) #updates resfile


pd.set_option('display.width', 220)
pd.set_option('display.max_columns', 20)

df = sr.make_simple_df_from_slope_file(slopes_filename)

df = df.sort_values('date').reset_index(drop=True)

import re
def station_nr(filename):
    """return the number at the end of the raw data filename"""
    return int(re.findall(r'\d+', filename)[-1])


df['meas_nr'] = [station_nr(x) for x in df.filename]

Field_numbers = {
    (1, 'left'):    1,
    (1, 'right'):   13,
    (2, 'left'):    2,
    (2, 'right'):   14,
    (3, 'left'):    3,
    (3, 'right'):   15,
    (4, 'left'):    4,
    (4, 'right'):   16,
    (5, 'left'):    5,
    (5, 'right'):   17,
    (6, 'left'):    6,
    (6, 'right'):   18,
    (7, 'left'):    7,
    (7, 'right'):   19,
    (8, 'left'): 8,
    (8, 'right'): 20,
    (9, 'left'): 9,
    (9, 'right'): 21,
    (10, 'left'): 10,
    (10, 'right'): 22,
    (11, 'left'): 11,
    (11, 'right'): 23,
    (12, 'left'): 12,
    (12, 'right'): 24,
    (13, 'left'): 48,
    (13, 'right'): 36,
    (14, 'left'): 47,
    (14, 'right'): 35,
    (15, 'left'): 46,
    (15, 'right'): 34,
    (16, 'left'): 45,
    (16, 'right'): 33,
    (17, 'left'): 44,
    (17, 'right'): 32,
    (18, 'left'): 43,
    (18, 'right'): 31,
    (19, 'left'): 42,
    (19, 'right'): 30,
    (20, 'left'): 41,
    (20, 'right'): 29,
    (21, 'left'): 40,
    (21, 'right'): 28,
    (22, 'left'): 39,
    (22, 'right'): 27,
    (23, 'left'): 38,
    (23, 'right'): 26,
    (24, 'left'): 37,
    (24, 'right'):25,
}

# 1:{"name": "verbalt navn", "treatment": "kortavn", "plots":(1,6,7)},
treatment_legend = {
    1: {"name": "Barley+ryegrass Moved", "treatment": "2B", "plots": (1, 6, 7, 12)},
    2: {"name": "Barley+ryegrass Control", "treatment": "2A", "plots": (2, 5, 8, 11)},
    3: {"name": "Barley+ryegrass Mov+Min", "treatment": "2C", "plots": (3, 4, 9, 10)},
    4: {"name": "Barley Moved", "treatment": "1B", "plots": (13, 18, 19, 24)},
    5: {"name": "Barley Control", "treatment": "1A", "plots": (14, 17, 20, 23)},
    6: {"name": "Barley Mov+Min", "treatment": "1C", "plots": (15, 16, 21, 22)},
    7: {"name": "Cover crops Moved", "treatment": "3B", "plots": (25, 30, 31, 36)},
    8: {"name": "Cover crops Control", "treatment": "3A", "plots": (26, 29, 32, 35)},
    9: {"name": "Cover crops Mov+Min", "treatment": "3C", "plots": (27, 28, 33, 34)},
    10: {"name": "Ley Moved", "treatment": "4B", "plots": (37, 42, 43, 48)},
    11: {"name": "Ley Control", "treatment": "4A", "plots": (38, 41, 44, 47)},
    12: {"name": "Ley Mov+Min", "treatment": "4C", "plots": (39, 40, 45, 46)}
}

df["nr"] = [Field_numbers[(i, s)] for i, s in zip(df.meas_nr, df.side)]
df['treatment'] = [find_treatment_number(i,treatment_legend) for i in df.nr]

colors = 'bgrcmyk'*10
markers = '.......xxxxxxx'*5

for t in sorted(set(df.treatment)):
    d = df[df.treatment==t]
    plt.scatter(d.x, d.y, s=10, color=colors[t-1], marker=markers[t-1])

plt.axis('square')
plt.show()

df = finalize_df(df)
df['days'] = (df.t - min(df.t))/86400

print('from ', df.date.min())
print('to   ', df.date.max())

openthefineapp = False
excel_filenames = [fixpath(excel_filename_start + '_' + s + '.xlsx')
                   for s in 'RegressionOutput slopes all_columns'.split()]

# First, the main RegressionOutput file
try:
    df.to_excel(excel_filenames[0])
    print('Regression Output file(s) written to parent directory')
    if openthefineapp:
        os.system(excel_filenames[0])
except:
    print('Regression Output file(s) NOT written -- was it open?')
    pass

# _slopes and _all_columns are additional output files with regression results sorted by date
print(flux_units['N2O']['name'])
tokeep = ['t', 'date', 'days', 'nr', 'side', 'treatment',
          flux_units['N2O']['name'], flux_units['CO2']['name'],
          'N2O_slope', 'CO2_slope', 'filename']

df2 = df[df['options'].apply(check_exclude)][tokeep]

print("Making complete dataset")
df['index1'] = df.index
df_all,df_weather = make_dataset(df)
df_all.index=df_all.index1
df_all["excluded"] = df_all['options'].apply(check_exclude)
#write dataframe to pickle file
df_all.to_pickle('./output/df_all.pkl')
df_weather.to_pickle('./output/df_weather.pkl')


df2.to_excel(excel_filenames[1])

