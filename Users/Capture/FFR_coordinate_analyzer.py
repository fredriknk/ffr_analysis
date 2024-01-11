"""
 Sigrids capture experiments
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
pd.options.mode.chained_assignment = None
sys.path.append(os.path.realpath(os.path.join(os.getcwd(), '../../prog')))
import resdir
import get_data
import utils
import find_regressions
import sort_results as sr
import weather_data
import flux_calculations
import polygon_utils
from yaml import safe_load
# import ginput_show
# import textwrap
# import regression
# import divide_left_and_right
# from polygon_utils import plot_rectangles
# import scipy.stats
# from statsmodels.formula.api import ols#, rlm
# from statsmodels.stats.anova import anova_lm
# import statsmodels.api as sm
# from scipy.stats import norm
# import xlwt
#import shutil
#import errno

def read_yaml(file_path = "config.yml"):
    with open(file_path, "r") as f:
        return safe_load(f)
fixpath = utils.ensure_absolute_path

start_date = '2021-08-19'
stop_date =  '2099-01-01'  #YYYYMMDD  stop_date has to be one day after the last date you want
redo_regressions =  False

options = {'interval': 100,
           'start':0,
           'stop':180,
           'crit': 'steepest',
           'co2_guides': True,
           'correct_negatives':False
           }

save_options= {'show_images':False,
               'save_images':False,
               'save_detailed_excel':False,
               'sort_detailed_by_experiment':False
               }

remove_redoings_time = 10 #seconds

# flux_units = {'N2O': {'name': 'N2O_N_mmol_m2day', 'factor': 2 * 1000 * 86400},
#              'CO2': {'name': 'CO2_C_mmol_m2day', 'factor': 1000 * 86400}}
flux_units = {'N2O': {'name': 'N2O_N_mug_m2h', 'factor': 2 * 14 * 1e6 * 3600},
              'CO2': {'name': 'CO2_C_mug_m2h', 'factor': 12 * 1e6 * 3600}}

specific_options_filename = fixpath('specific_options.xls')


try:
    DATA_FILE_NAME = "config.yml"
    paths = read_yaml(DATA_FILE_NAME)["PATHS"]
    resdir.raw_data_path = paths["RAWDATA"]
    logger_path = paths['LOGGER_PATH']
    manual_path = paths['MANUAL']
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
# %%


def position(filename):
    a = get_data.parse_filename(filename)['vehicle_pos']
    return np.array([a['x'], a['y']])

positions = [position(name) for name in all_filenames]
x = np.array([x[0] for x in positions])
y = np.array([x[1] for x in positions])
offset = namedtuple('Point', ('x', 'y'))(x=5.99201e5, y=6.615259e6)
#plt.scatter(x-offset.x, y-offset.y, marker='.')

#--
def file_belongs(filename):
    name = os.path.split(filename)[1]
    date_ok = start_date <= name.replace('-','') <= stop_date
    x, y = position(filename)
    pos_ok = 0 < x - offset.x < 45 and 0 < y - offset.y < 55
    #text_ok = name.find('Measure') > -1
    return date_ok and pos_ok

filenames = [x for x in all_filenames if file_belongs(x)]
print('number of measurement files included in this run:', len(filenames))

filenames.sort() # alphabetically (i.e., by date)

# Make the "regressor object" regr which will be used further below.
# It contains the functions and parameters (options) for doing the regressions.

regr = find_regressions.Regressor(slopes_filename, options, save_options,
                                  specific_options_filename, detailed_output_path)

if not os.path.isfile(slopes_filename):
    open(slopes_filename, 'a').close() #creates the file

if redo_regressions:
    regr.find_regressions(filenames)
else:
    regr.update_regressions_file(filenames) #updates resfile


# plot_error_number(n, key='N2O'):

#%%
"""
Preparing the data for "RegressionOutput" Excel export
"""
# %%
#Sort results according to the rectangles, put them in a Pandas dataframe
# Read "10 minutes to pandas" to understand pandas (or spend a few hours)

pd.set_option('display.width', 220)
pd.set_option('display.max_columns', 20)

df = sr.make_simple_df_from_slope_file(slopes_filename)

df.sort_values('date', inplace=True)
#--
# plt.ion(); plt.cla()
# plt.scatter(df.x-offset.x, df.y-offset.y, s=1)
# plt.scatter(x-offset.x, y-offset.y, color="red", s=1)


rect1 = polygon_utils.Polygon(0, 0, W=37.5, L=48)
rect1.rotate(.4152).move(15.2,-2.55)
# rect1.rotate(.4152).move(599216.2,6615256.5)

rectangles = rect1.grid(6,6)

polygon_utils.plot_rectangles(rectangles, textkwargs={'fontsize': 5}, linewidth=.1)

df['nr'] = [polygon_utils.find_polygon(p[0]-offset.x, p[1]-offset.y, rectangles) + 1
            for p in  zip(df.x, df.y)]


treatmentlist = [( 1,  6), ( 2,  2), ( 3, 12), ( 4,  7), ( 5,  4), ( 6,  9),
                 ( 7, 11), ( 8, 10), ( 9,  1), (10,  5), (11,  8), (12,  3),
                 (13, 12), (14, 11), (15,  4), (16, 10), (17,  5), (18,  2),
                 (19,  1), (20,  7), (21,  8), (22,  6), (23,  3), (24,  9),
                 (25,  3), (26, 10), (27,  2), (28,  4), (29,  5), (30,  1),
                 (31, 11), (32,  6), (33, 12), (34,  9), (35,  8), (36,  7)]

treatments = {x[0]:x[1] for x in treatmentlist}

df['treatment'] = [treatments[i] for i in df.nr]


polygon_utils.plot_rectangles(rectangles, textkwargs={'fontsize': 5}, linewidth=.1)

colors = 'bgrcmyk'*10
markers = '.......xxxxxxx'*5

poso = pd.read_csv("raw_data/capture_long.csv", index_col = False)
posn = pd.read_csv("raw_data/capture_long_ny_gps.csv", index_col = False,names=["x","y","z","heading","type","side","name"])
#
# for t in sorted(set(df.treatment)):
#     d = df[df.treatment==t]
#     plt.scatter(d.x-offset.x, d.y-offset.y, s=10, color=colors[t-1], marker=markers[t-1])

# plt.scatter(pos_old.x-offset.x, pos_old.y-offset.y, s=10, color=colors[0], marker=markers[0])

j = 0
pos = posn
dx = -0.3161831388845005
dy = 0.8359158332459629
pos.x += dx
pos.y += dy

for i,type in enumerate(pos.type.unique()):
    i =  i+ j
    pos_ = pos[pos.type == type]
    plt.scatter(pos_.x-offset.x, pos_.y-offset.y, s=10, color=colors[i], marker=markers[i])

pos = poso


j= i
for i,type in enumerate(pos.type.unique()):
    i = i+ j
    pos_ = pos[pos.type == type]
    plt.scatter(pos_.x-offset.x, pos_.y-offset.y, s=10, color=colors[i], marker=markers[i])

plt.axis('square')
plt.show()


pos = posn
posN = pos[pos.type=="Measure"].reset_index()[["x","y","heading"]]

pos = poso
posO = pos[pos.type=="Measure"].reset_index()[["x","y","heading"]]